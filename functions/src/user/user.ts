import * as functions from 'firebase-functions/v1';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';


import { isCorsAllowed } from '../utils';
import { FUNCTIONS_MANIFEST } from '../../../src/shared/functions-manifest';

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

