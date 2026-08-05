import { ServiceNames, Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import * as admin from 'firebase-admin';
import { ServiceTokenInput } from '../shared/token-types';

// Re-export for convenience
export { ServiceTokenInput } from '../shared/token-types';

export interface ServiceAuthAdapter {
    serviceName: ServiceNames;
    tokenCollectionName: string;
    oAuthScopes: string;

    // Configuration
    getOAuth2Client(refresh?: boolean): AuthorizationCode;

    // Authorization Flow
    // Authorization Flow
    // Returns options for authorizeURL, and context data to be saved in Firestore
    getAuthorizationData(redirectUri: string, state: string): Promise<{ options: any; context?: any }>;

    // Returns config object for getToken
    getTokenRequestConfig(redirectUri: string, code: string, context?: any): any;

    // Token Processing
    // uniqueId is optional because some services return it in the token response (Garmin/Suunto/COROS variants)
    convertTokenResponse(response: AccessToken, uniqueId?: string, extraData?: any): ServiceTokenInput;

    // Process post-token logic (e.g. fetch User ID from API if not in token)
    processNewToken(token: AccessToken, userId: string): Promise<{ uniqueId?: string; permissions?: string[] }>;

    // Deauthorization
    deauthorize(token: Auth2ServiceTokenInterface): Promise<void>;

    // Deduplication
    getDuplicateConnectionQuery(externalUserId: string): admin.firestore.Query;
}
