import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ALLOWED_CORS_ORIGINS } from '../utils';

/**
 * Lists all users with their custom claims and metadata.
 * Only accessible by users with the 'admin' custom claim.
 */
export const listUsers = onCall({
    region: 'europe-west2',
    cors: ALLOWED_CORS_ORIGINS,
    memory: '1GiB',
}, async (request) => {
    // 1. Check authentication
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    // 2. Check for admin claim
    if (request.auth.token.admin !== true) {
        throw new HttpsError('permission-denied', 'Only admins can call this function.');
    }

    try {
        const pageSize = (request.data && request.data.pageSize) ? parseInt(request.data.pageSize) : 100;
        const pageToken = (request.data && request.data.nextPageToken) || undefined;

        // Fetch ONE batch of users
        const listUsersResult = await admin.auth().listUsers(pageSize, pageToken);

        // Enrich users with subscription and connected services data
        const enrichedUsers = await Promise.all(listUsersResult.users.map(async (userRecord) => {
            const db = admin.firestore();
            let subscriptionData = null;
            const connectedServices: { provider: string; connectedAt: any }[] = [];

            try {
                // Parallel fetching of Subscriptions and Services
                const [subsSnapshot, garminDoc, suuntoSnapshot, corosSnapshot] = await Promise.all([
                    // 1. Subscription (Active/Trialing)
                    db.collection('customers')
                        .doc(userRecord.uid)
                        .collection('subscriptions')
                        .where('status', 'in', ['active', 'trialing', 'past_due'])
                        .orderBy('created', 'desc')
                        .limit(1)
                        .get(),
                    // 2. Garmin
                    db.collection('garminHealthAPITokens').doc(userRecord.uid).get(),
                    // 3. Suunto
                    db.collection('suuntoAppAccessTokens').doc(userRecord.uid).collection('tokens').limit(1).get(),
                    // 4. COROS
                    db.collection('COROSAPIAccessTokens').doc(userRecord.uid).collection('tokens').limit(1).get()
                ]);

                // Process Subscription
                if (!subsSnapshot.empty) {
                    const sub = subsSnapshot.docs[0].data();
                    subscriptionData = {
                        status: sub.status,
                        current_period_end: sub.current_period_end,
                        cancel_at_period_end: sub.cancel_at_period_end,
                        stripeLink: sub.stripeLink
                    };
                }

                // Process Connected Services
                if (garminDoc.exists) {
                    // Garmin often has 'created' or we use a fallback
                    const data = garminDoc.data();
                    connectedServices.push({ provider: 'Garmin', connectedAt: data?.created || null });
                }
                if (!suuntoSnapshot.empty) {
                    const data = suuntoSnapshot.docs[0].data();
                    connectedServices.push({ provider: 'Suunto', connectedAt: data?.created || null });
                }
                if (!corosSnapshot.empty) {
                    const data = corosSnapshot.docs[0].data();
                    connectedServices.push({ provider: 'COROS', connectedAt: data?.created || null });
                }

            } catch (e) {
                console.warn(`Failed to fetch details for ${userRecord.uid}`, e);
            }

            return {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName,
                photoURL: userRecord.photoURL,
                customClaims: userRecord.customClaims || {},
                metadata: {
                    lastSignInTime: userRecord.metadata?.lastSignInTime || null,
                    creationTime: userRecord.metadata?.creationTime || null,
                },
                disabled: userRecord.disabled,
                subscription: subscriptionData,
                connectedServices: connectedServices
            };
        }));

        return {
            users: enrichedUsers,
            nextPageToken: listUsersResult.pageToken
        };
    } catch (error: any) {
        console.error('Error listing users:', error);
        throw new HttpsError('internal', error.message || 'Failed to list users');
    }
});

