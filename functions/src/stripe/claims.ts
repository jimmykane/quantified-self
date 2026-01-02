import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS } from '../utils';


export const restoreUserClaims = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    try {
        const { role } = await reconcileClaims(request.auth.uid);
        return { success: true, role };
    } catch (error: any) {
        // Map known errors to HttpsError if needed, or rethrow if already HttpsError
        if (error instanceof HttpsError) {
            throw error;
        }
        // Generic handling
        throw new HttpsError('internal', error.message || 'Failed to reconcile claims');
    }
});

/**
 * Reconciles the user's Stripe subscription status with their Firebase Auth custom claims.
 * 
 * Flow:
 * 1. Checks for active or trialing subscriptions in Firestore.
 * 2. Determines the role based on subscription metadata.
 * 3. Sets the `stripeRole` custom claim.
 * 
 * @param uid The usage ID to reconcile.
 * @returns The reconciled role.
 */
export async function reconcileClaims(uid: string): Promise<{ role: string }> {
    const db = admin.firestore();
    const subscriptionsRef = db.collection(`customers/${uid}/subscriptions`);

    // Check for any active or trialing subscription
    // We only take the most recent one created
    const snapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
        // Fallback: Check if the user exists in Stripe by email
        // This handles cases where a user deleted their account and recreated it
        logger.info(`[reconcileClaims] No local subscription found for ${uid}. Checking Stripe by email...`);

        const user = await admin.auth().getUser(uid);
        if (user.email) {
            const stripe = await getStripe();
            const customers = await stripe.customers.search({
                query: `email:'${user.email}'`,
                limit: 1
            });

            if (customers.data.length > 0) {
                const customer = customers.data[0];
                logger.info(`[reconcileClaims] Found Stripe customer ${customer.id} for email ${user.email}`);

                // Check for active subscriptions for this customer in Stripe
                const subscriptions = await stripe.subscriptions.list({
                    customer: customer.id,
                    status: 'active',
                    limit: 1
                });

                if (subscriptions.data.length > 0) {
                    const sub = subscriptions.data[0];
                    logger.info(`[reconcileClaims] Found active Stripe subscription ${sub.id}`);

                    // Link the found customer to the new Firebase User
                    await db.collection('customers').doc(uid).set({
                        stripeId: customer.id,
                        stripeLink: `https://dashboard.stripe.com/customers/${customer.id}` // Optional helper
                    }, { merge: true });

                    // We need to determine the role.
                    // Ideally, we look at metadata on the product or subscription.
                    // For now, we mimic the logic: try subscription metadata first
                    let role = sub.metadata?.role || sub.metadata?.firebaseRole;

                    if (!role) {
                        // Fetch product to get role
                        const priceItem = sub.items.data[0];
                        if (priceItem?.price?.product) {
                            const productId = typeof priceItem.price.product === 'string'
                                ? priceItem.price.product
                                : priceItem.price.product.id;

                            const product = await stripe.products.retrieve(productId);
                            role = product.metadata?.role || product.metadata?.firebaseRole;
                        }
                    }

                    if (role) {
                        logger.info(`[reconcileClaims] Restored role ${role} from Stripe for user ${uid}`);
                        // Set claims
                        const existingClaims = user.customClaims || {};
                        await admin.auth().setCustomUserClaims(uid, {
                            ...existingClaims,
                            stripeRole: role
                        });
                        return { role };
                    }
                }
            }
        }

        // No active subscription? remove claims or set to free?
        // Current logic implies "restore" failed if found nothing, but reconcilliation might mean "set to free"
        // Following original "restore" behavior: throw error if nothing found.
        throw new HttpsError('not-found', 'No active subscription found.');
    }

    const subData = snapshot.docs[0].data();

    // Priority:
    // 1. `role` (Populated by Stripe Extension)
    const role = subData.role;

    logger.info(`[reconcileClaims] Metadata check - role: ${subData.role}`);

    if (!role) {
        throw new HttpsError('failed-precondition', 'Subscription found but no role defined in document.');
    }

    // Set custom user claims on this specific user
    logger.info(`[reconcileClaims] Final decision - Setting claims for user ${uid} to role: ${role}`);

    // Fetch existing claims to avoid overwriting other claims like 'admin'
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};

    await admin.auth().setCustomUserClaims(uid, {
        ...existingClaims,
        stripeRole: role
    });

    return { role };
}

import { getStripe } from './client';
