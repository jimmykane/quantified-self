import { onCall, HttpsError, CallableOptions, CallableRequest } from 'firebase-functions/v2/https';
import { ALLOWED_CORS_ORIGINS } from '../utils';

/**
 * Higher-order function that wraps an onCall handler with admin authorization checks.
 * 
 * It automatically:
 * 1. Verifies the request is authenticated.
 * 2. Verifies the user has the 'admin' custom claim.
 * 3. Enforces standard CORS origins and region.
 * 
 * @param options - Firebase Function options (will be merged with admin defaults)
 * @param handler - The actual function logic to execute if auth passes
 * @returns A Firebase Cloud Function
 */
export function onAdminCall<T = unknown, R = unknown>(
    options: Omit<CallableOptions, 'cors'>,
    handler: (request: CallableRequest<T>) => R | Promise<R>
) {
    return onCall({
        ...options,
        cors: ALLOWED_CORS_ORIGINS,
    }, async (request) => {
        // 1. Check authentication
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
        }

        // 2. Check for admin claim
        if (request.auth.token.admin !== true) {
            throw new HttpsError('permission-denied', 'Only admins can call this function.');
        }

        // 3. Execute the handler
        return handler(request);
    });
}
