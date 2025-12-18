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

    const uid = request.auth.uid;
    const subscriptionsRef = admin.firestore().collection(`customers/${uid}/subscriptions`);

    // Check for any active or trialing subscription
    const snapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
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
            console.log(`[restoreUserClaims] Mapped price ${priceId} to role ${role}`);
        } else {
            console.warn(`[restoreUserClaims] Price ${priceId} not found in PRICE_TO_PLAN. Using metadata role: ${role}`);
        }
    }

    if (!role) {
        throw new HttpsError('failed-precondition', 'Subscription found but no role defined/mapped.');
    }

    // Set custom user claims on this specific user
    await admin.auth().setCustomUserClaims(uid, { stripeRole: role });

    console.log(`Manually restored claims for user ${uid} to active role: ${role}`);

    return { success: true, role };
});
