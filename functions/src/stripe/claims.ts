import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ALLOWED_CORS_ORIGINS } from '../utils';

import { PRICE_TO_PLAN } from '../shared/pricing';

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
 * 2. Determines the role based on PRICE_TO_PLAN mapping or subscription metadata.
 * 3. Sets the `stripeRole` custom claim.
 * 
 * @param uid The usage ID to reconcile.
 * @returns The reconciled role.
 */
export async function reconcileClaims(uid: string): Promise<{ role: string }> {
    const subscriptionsRef = admin.firestore().collection(`customers/${uid}/subscriptions`);

    // Check for any active or trialing subscription
    // We only take the most recent one created
    const snapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
        // No active subscription? remove claims or set to free?
        // Current logic implies "restore" failed if found nothing, but reconcilliation might mean "set to free"
        // Following original "restore" behavior: throw error if nothing found.
        throw new HttpsError('not-found', 'No active subscription found.');
    }

    const subData = snapshot.docs[0].data();
    let role = subData.role; // Default to metadata role

    // Check items/price_id against hardcoded map
    // Subscription items structure: items: [ { price: { id: "..." } } ]
    if (subData.items && subData.items.length > 0) {
        const priceId = subData.items[0].price.id;
        if (PRICE_TO_PLAN[priceId]) {
            role = PRICE_TO_PLAN[priceId];
            console.log(`[reconcileClaims] Mapped price ${priceId} to role ${role}`);
        } else {
            console.warn(`[reconcileClaims] Price ${priceId} not found in PRICE_TO_PLAN. Using metadata role: ${role}`);
        }
    }

    if (!role) {
        throw new HttpsError('failed-precondition', 'Subscription found but no role defined/mapped.');
    }

    // Set custom user claims on this specific user
    await admin.auth().setCustomUserClaims(uid, { stripeRole: role });

    console.log(`[reconcileClaims] Reconciled claims for user ${uid} to active role: ${role}`);

    return { role };
}
