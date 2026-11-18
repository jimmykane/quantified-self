import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { USER_DELETION_TOMBSTONES_COLLECTION } from '../shared/user-deletion-guard';


import { isCorsAllowed } from '../utils';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { deleteAuthAccountAndNotify, pendingAccountDeletionMarker } from '../users/initiate-deletion';

export const deleteSelf = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '256MB'
    })
    .region(FUNCTIONS_MANIFEST.deleteSelf.region)
    .https.onCall(async (data, context) => {
        if (!isCorsAllowed(context.rawRequest)) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'The function must be called from an allowed origin.'
            );
        }
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'The function must be called while authenticated.'
            );
        }
        if (!context.app) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'The function must be called from an App Check verified app.'
            );
        }

        const uid = context.auth.uid;
        const firestore = admin.firestore();
        const deletionMarkerRef = firestore.collection(USER_DELETION_TOMBSTONES_COLLECTION).doc(uid);
        logger.info(`Requesting deletion for user: ${uid} `);

        try {
            let userEmail: string | undefined;
            try {
                const userRecord = await admin.auth().getUser(uid);
                userEmail = userRecord.email ?? undefined;
            } catch (lookupError) {
                logger.warn(`Could not fetch user email before deletion for ${uid}. Continuing with deletion.`, lookupError);
            }

            try {
                const pendingMarker = pendingAccountDeletionMarker('deleteSelf');
                await firestore.runTransaction(async transaction => {
                    const existing = await transaction.get(deletionMarkerRef);
                    // Another deletion can complete after the Auth lookup. Always
                    // preserve its verified receipt atomically: a repeated deleteUser
                    // may find Auth absent and emit no new event to finish a reset fence.
                    if (existing.get('cleanupStatus') !== 'complete') {
                        transaction.set(deletionMarkerRef, pendingMarker, { merge: true });
                    }
                });
            } catch (markerError) {
                logger.error(`Failed to write user deletion marker for ${uid}. Aborting deletion.`, markerError);
                throw markerError;
            }

            await deleteAuthAccountAndNotify(uid, userEmail);

            return { success: true };
        } catch (error) {
            logger.error('Error deleting user:', error);
            throw new functions.https.HttpsError('internal', 'Unable to delete user', error);
        }
    });
