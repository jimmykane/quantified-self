
import * as logger from 'firebase-functions/logger';
import { getTokenData } from '../tokens';
import { SERVICE_NAME } from './constants';
import * as admin from 'firebase-admin';
import { SuuntoAPIAuth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { isSuuntoOAuthRejection } from './authorization-recovery';

async function tokenForRequest(
    tokenDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
    forceRefresh: boolean,
): Promise<SuuntoAPIAuth2ServiceTokenInterface> {
    try {
        return await getTokenData(tokenDoc, SERVICE_NAME, forceRefresh) as SuuntoAPIAuth2ServiceTokenInterface;
    } catch (error: any) {
        // A token-endpoint 403 did not test resource permission. Leave credential
        // handling to the coordinator and durable retry to the caller, including when the
        // initial expiry-based refresh fails before the first resource request.
        if ((error?.statusCode ?? error?.response?.statusCode) === 403) {
            throw Object.assign(new Error('Suunto token refresh was rejected; resource access was not retried.'), { statusCode: 503 });
        }
        throw error;
    }
}

/**
 * Retries one explicitly rejected OAuth resource request after same-account refresh.
 * Never wrap signed blob requests, refresh calls, or a complete multi-step upload.
 * 
 * @param tokenDoc The Firestore document snapshot of the token.
 * @param operation A function that takes the access token and returns a Promise.
 * @param _contextDescription Legacy caller context; never logged because it may contain private identifiers.
 * @returns The result of the operation.
 * @throws The last error encountered if retries fail.
 */
export async function executeWithTokenRetry<T>(
    tokenDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
    operation: (accessToken: string, token: SuuntoAPIAuth2ServiceTokenInterface) => Promise<T>,
    _contextDescription: string
): Promise<T> {
    // First attempt: Get token without force refresh
    let serviceToken = await tokenForRequest(tokenDoc, false);

    try {
        return await operation(serviceToken.accessToken, serviceToken);
    } catch (e: any) {
        const statusCode = e?.statusCode ?? e?.response?.statusCode;
        const isAuthError = isSuuntoOAuthRejection(e);

        if (isAuthError) {
            logger.info('[SuuntoAuth] Resource request rejected; attempting one same-account refresh.', {
                statusCode: statusCode === 401 || statusCode === 403 ? statusCode : undefined,
            });

            const previousAccount = serviceToken.userName;
            serviceToken = await tokenForRequest(tokenDoc, true);
            if (previousAccount && serviceToken.userName !== previousAccount) {
                throw new Error('Suunto account changed during authorization recovery.');
            }
            return operation(serviceToken.accessToken, serviceToken);
        } else {
            // Preserve the original classification for other failures.
            throw e;
        }
    }
}
