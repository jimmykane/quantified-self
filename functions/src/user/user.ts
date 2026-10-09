import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { USER_DELETION_TOMBSTONES_COLLECTION } from '../shared/user-deletion-guard';


import { isCorsAllowed } from '../utils';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import {
    TRANSACTIONAL_EMAIL_FROM,
    TRANSACTIONAL_EMAIL_REPLY_TO,
} from '../email/config';

type FirebaseAuthErrorLike = {
    errorInfo?: {
        code?: string;
    };
};


const isAuthUserNotFoundError = (error: unknown): boolean => {
    return (error as FirebaseAuthErrorLike)?.errorInfo?.code === 'auth/user-not-found';
};

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
                const pendingMarker = {
                    createdAt: FieldValue.serverTimestamp(),
                    source: 'deleteSelf',
                    cleanupStatus: 'pending',
                    // Unfinished deletion must never lose its writer fence to TTL.
                    expireAt: FieldValue.delete(),
                    completedAt: FieldValue.delete(),
                };
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

            // Delete Auth User (idempotent if already deleted)
            try {
                await admin.auth().deleteUser(uid);
                logger.info(`Successfully deleted user auth: ${uid} `);
            } catch (deleteError) {
                if (isAuthUserNotFoundError(deleteError)) {
                    logger.warn(`User ${uid} was already deleted in auth. Treating deletion as successful.`, deleteError);
                } else {
                    // A failed Auth RPC may have committed before its response was lost.
                    // Retain the fence; retrying deleteSelf is safe and remains permitted.
                    throw deleteError;
                }
            }

            if (userEmail) {
                try {
                    await admin.firestore().collection('mail').doc(`account_deleted_confirmation_${uid}`).set({
                        to: userEmail,
                        from: TRANSACTIONAL_EMAIL_FROM,
                        replyTo: TRANSACTIONAL_EMAIL_REPLY_TO,
                        template: {
                            name: 'account_deleted_confirmation',
                            data: {
                                support_email: TRANSACTIONAL_EMAIL_REPLY_TO,
                            }
                        },
                        expireAt: getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS),
                    });
                    logger.info(`Queued account deletion confirmation email for user: ${uid}`);
                } catch (mailError) {
                    logger.error(`Failed to queue account deletion confirmation email for user: ${uid}`, mailError);
                }
            } else {
                logger.info(`No email found for deleted user ${uid}. Skipping account deletion confirmation email.`);
            }

            return { success: true };
        } catch (error) {
            logger.error('Error deleting user:', error);
            throw new functions.https.HttpsError('internal', 'Unable to delete user', error);
        }
    });
