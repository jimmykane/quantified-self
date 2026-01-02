import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS } from '../utils';
import { getStripe } from './client';

/**
 * Result of attempting to find and link a Stripe customer by email.
 */
interface LinkResult {
    found: boolean;
    role?: string;
    customerId?: string;
}

/**
 * Shared helper to find a Stripe customer by email, link it to the Firebase user,
 * and set claims based on active subscription.
 * 
 * @param uid Firebase user ID
 * @param email User's email address
 * @param user Firebase Auth user record (to preserve existing claims)
 * @returns LinkResult indicating if a subscription was found and linked
 */
async function findAndLinkStripeCustomerByEmail(
    uid: string,
    email: string,
    user: admin.auth.UserRecord
): Promise<LinkResult> {
    const db = admin.firestore();
    const stripe = await getStripe();

    // Search for existing customers with this email
    const customers = await stripe.customers.search({
        query: `email:'${email}'`,
        limit: 10 // Get multiple in case there are duplicates
    });

    if (customers.data.length === 0) {
        logger.info(`[findAndLinkStripeCustomerByEmail] No Stripe customer found for email ${email}`);
        return { found: false };
    }

    // Find a customer with an active subscription
    for (const customer of customers.data) {
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 1
        });

        if (subscriptions.data.length > 0) {
            const sub = subscriptions.data[0];
            logger.info(`[findAndLinkStripeCustomerByEmail] Found subscription ${sub.id} for customer ${customer.id}`);

            // Link this customer to the Firebase user
            await db.collection('customers').doc(uid).set({
                stripeId: customer.id,
                stripeLink: `https://dashboard.stripe.com/customers/${customer.id}`
            }, { merge: true });

            // Determine the role from subscription or product metadata
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
                // Set claims
                const existingClaims = user.customClaims || {};
                await admin.auth().setCustomUserClaims(uid, {
                    ...existingClaims,
                    stripeRole: role
                });

                logger.info(`[findAndLinkStripeCustomerByEmail] Linked customer ${customer.id} to user ${uid} with role ${role}`);
                return { found: true, role, customerId: customer.id };
            }
        }
    }

    logger.info(`[findAndLinkStripeCustomerByEmail] No active subscription found for email ${email}`);
    return { found: false };
}


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
    } catch (error: unknown) {
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', (error as Error).message || 'Failed to reconcile claims');
    }
});

/**
 * Reconciles the user's Stripe subscription status with their Firebase Auth custom claims.
 * 
 * Flow:
 * 1. Checks for active or trialing subscriptions in Firestore.
 * 2. Falls back to Stripe email search if no local subscription.
 * 3. Sets the `stripeRole` custom claim.
 */
export async function reconcileClaims(uid: string): Promise<{ role: string }> {
    const db = admin.firestore();
    const subscriptionsRef = db.collection(`customers/${uid}/subscriptions`);

    // Check for any active or trialing subscription
    const snapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
        // Fallback: Check if the user exists in Stripe by email
        logger.info(`[reconcileClaims] No local subscription found for ${uid}. Checking Stripe by email...`);

        const user = await admin.auth().getUser(uid);
        if (user.email) {
            const result = await findAndLinkStripeCustomerByEmail(uid, user.email, user);
            if (result.found && result.role) {
                return { role: result.role };
            }
        }

        throw new HttpsError('not-found', 'No active subscription found.');
    }

    const subData = snapshot.docs[0].data();
    const role = subData.role;

    logger.info(`[reconcileClaims] Metadata check - role: ${subData.role}`);

    if (!role) {
        throw new HttpsError('failed-precondition', 'Subscription found but no role defined in document.');
    }

    // Set custom user claims
    logger.info(`[reconcileClaims] Setting claims for user ${uid} to role: ${role}`);
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};

    await admin.auth().setCustomUserClaims(uid, {
        ...existingClaims,
        stripeRole: role
    });

    return { role };
}

/**
 * Checks if the authenticated user has an existing Stripe customer with an active subscription.
 * If found, links that customer to the current Firebase user and sets their claims.
 * This should be called BEFORE creating a checkout session to prevent duplicate subscriptions.
 */
export const linkExistingStripeCustomer = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const uid = request.auth.uid;

    try {
        const user = await admin.auth().getUser(uid);
        if (!user.email) {
            logger.info(`[linkExistingStripeCustomer] User ${uid} has no email, cannot search Stripe.`);
            return { linked: false };
        }

        const result = await findAndLinkStripeCustomerByEmail(uid, user.email, user);

        if (result.found && result.role) {
            return { linked: true, role: result.role };
        }

        return { linked: false };
    } catch (error: unknown) {
        logger.error('[linkExistingStripeCustomer] Error:', error);
        if (error instanceof HttpsError) {
            throw error;
        }
        throw new HttpsError('internal', (error as Error).message || 'Failed to check for existing subscription');
    }
});
