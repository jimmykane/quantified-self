import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { onAdminCall } from '../../shared/auth';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../../utils';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { ImpersonateUserRequest, TokenResponse } from '../shared/types';

/**
 * Impersonates a user by generating a custom token.
 * This allows an admin to sign in as the target user.
 *
 * SECURITY: Critical function. Only strictly verified admins can call this.
 */
export const impersonateUser = onAdminCall<ImpersonateUserRequest, TokenResponse>({
    region: FUNCTIONS_MANIFEST.impersonateUser.region,
    memory: '256MiB',
}, async (request) => {
    const targetUid = request.data.uid;
    if (!targetUid || typeof targetUid !== 'string') {
        throw new HttpsError('invalid-argument', 'The function must be called with a valid user UID.');
    }

    try {
        const additionalClaims = {
            impersonatedBy: request.auth!.uid
        };

        const customToken = await admin.auth().createCustomToken(targetUid, additionalClaims);

        logger.info(`Admin ${request.auth!.uid} is impersonating user ${targetUid}`);

        return {
            token: customToken
        };

    } catch (error: unknown) {
        logger.error('Error creating impersonation token:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to create token';
        throw new HttpsError('internal', errorMessage);
    }
});

/**
 * Ends an impersonation session and restores the original admin account.
 *
 * This relies on the `impersonatedBy` claim that was attached to the
 * impersonated user's custom token when the session started.
 */
export const stopImpersonation = onCall({
    region: FUNCTIONS_MANIFEST.stopImpersonation.region,
    memory: '256MiB',
    cors: ALLOWED_CORS_ORIGINS,
}, async (request): Promise<TokenResponse> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const adminUid = request.auth.token.impersonatedBy;
    if (typeof adminUid !== 'string' || adminUid.length === 0) {
        throw new HttpsError('permission-denied', 'The current session is not impersonating another user.');
    }

    const auth = admin.auth();

    try {
        const adminUser = await auth.getUser(adminUid);
        if (adminUser.disabled || adminUser.customClaims?.admin !== true) {
            throw new HttpsError('permission-denied', 'The original admin session is no longer eligible for restoration.');
        }
    } catch (error: unknown) {
        if (error instanceof HttpsError) {
            throw error;
        }

        logger.warn(`Unable to load original admin ${adminUid} while ending impersonation for ${request.auth.uid}`, error);
        throw new HttpsError('permission-denied', 'The original admin session is no longer available.');
    }

    try {
        const customToken = await auth.createCustomToken(adminUid);
        logger.info(`User ${request.auth.uid} ended impersonation and returned to admin ${adminUid}`);
        return {
            token: customToken
        };
    } catch (error: unknown) {
        logger.error('Error creating admin restoration token:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to create token';
        throw new HttpsError('internal', errorMessage);
    }
});
