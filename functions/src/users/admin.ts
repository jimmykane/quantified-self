
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
        const users: any[] = [];
        let nextPageToken;

        // Fetch users in batches of 1000
        do {
            const listUsersResult = await admin.auth().listUsers(1000, nextPageToken);
            listUsersResult.users.forEach((userRecord) => {
                users.push({
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
                });
            });
            nextPageToken = listUsersResult.pageToken;
        } while (nextPageToken);

        return { users };
    } catch (error: any) {
        console.error('Error listing users:', error);
        throw new HttpsError('internal', error.message || 'Failed to list users');
    }
});
