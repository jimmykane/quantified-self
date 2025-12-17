import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

export const restoreUserClaims = functions.region('europe-west2').https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const uid = context.auth.uid;
    const subscriptionsRef = admin.firestore().collection(`customers/${uid}/subscriptions`);

    // Check for any active or trialing subscription
    const snapshot = await subscriptionsRef
        .where('status', 'in', ['active', 'trialing'])
        .orderBy('created', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
        throw new functions.https.HttpsError('not-found', 'No active subscription found.');
    }

    const subData = snapshot.docs[0].data();
    const role = subData.role || 'premium'; // Default to premium if not set, or read from metadata

    // Set custom user claims on this specific user
    await admin.auth().setCustomUserClaims(uid, { stripeRole: role });

    console.log(`Manually restored claims for user ${uid} to active role: ${role}`);

    return { success: true, role };
});
