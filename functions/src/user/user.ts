import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';


import { isCorsAllowed } from '../utils';

export const deleteSelf = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '256MB'
    })
    .region('europe-west2')
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

        const uid = context.auth.uid;
        logger.info(`Requesting deletion for user: ${uid} `);

        try {
            // Delete Auth User
            await admin.auth().deleteUser(uid);
            logger.info(`Successfully deleted user auth: ${uid} `);

            return { success: true };
        } catch (error) {
            logger.error('Error deleting user:', error);
            throw new functions.https.HttpsError('internal', 'Unable to delete user', error);
        }
    });

