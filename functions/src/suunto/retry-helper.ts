
import * as logger from 'firebase-functions/logger';
import { getTokenData } from '../tokens';
import { SERVICE_NAME } from './constants';
import * as admin from 'firebase-admin';
import { SuuntoAPIAuth2ServiceTokenInterface } from '@sports-alliance/sports-lib';

/**
 * Executes an operation with a Suunto token, automatically handling 401 retries by refreshing the token.
 * 
 * @param tokenDoc The Firestore document snapshot of the token.
 * @param operation A function that takes the access token and returns a Promise.
 * @param contextDescription A description of the operation for logging purposes.
 * @returns The result of the operation.
 * @throws The last error encountered if retries fail.
 */
export async function executeWithTokenRetry<T>(
    tokenDoc: admin.firestore.QueryDocumentSnapshot,
    operation: (accessToken: string) => Promise<T>,
    contextDescription: string
): Promise<T> {
    let serviceToken: SuuntoAPIAuth2ServiceTokenInterface;

    // First attempt: Get token without force refresh
    try {
        serviceToken = (await getTokenData(tokenDoc, SERVICE_NAME, false)) as SuuntoAPIAuth2ServiceTokenInterface;
    } catch (e: any) {
        logger.warn(`Initial token fetch failed for ${contextDescription} (Token ID: ${tokenDoc.id})`, e);
        throw e;
    }

    try {
        return await operation(serviceToken.accessToken);
    } catch (e: any) {
        // Check for 401 Unauthorized or specific invalid_grant errors
        const statusCode = e.statusCode || (e.response && e.response.statusCode);
        const isAuthError = statusCode === 401 || (e.error && e.error.error === 'invalid_grant');

        if (isAuthError) {
            logger.warn(`Unauthorized (${statusCode}) during ${contextDescription} for token ${tokenDoc.id}. Attempting force refresh and retry...`);

            try {
                // Force refresh
                serviceToken = (await getTokenData(tokenDoc, SERVICE_NAME, true)) as SuuntoAPIAuth2ServiceTokenInterface;

                // Retry operation
                return await operation(serviceToken.accessToken);
            } catch (retryError: any) {
                logger.error(`Retry failed regarding ${contextDescription} for token ${tokenDoc.id} even after force refresh`, retryError);
                throw retryError;
            }
        } else {
            // Not a 401, rethrow original error
            throw e;
        }
    }
}
