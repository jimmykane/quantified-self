import { ServiceAuthAdapter, ServiceTokenInput } from '../../auth/ServiceAuthAdapter';
import { ServiceNames, Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import * as admin from 'firebase-admin';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../constants';
import { COROSAPIAuth } from './auth';
import { getCOROSUserId, deauthorizeCOROSUser } from './api';

export class COROSAuthAdapter implements ServiceAuthAdapter {
    public serviceName = ServiceNames.COROSAPI;
    public tokenCollectionName = COROSAPI_ACCESS_TOKENS_COLLECTION_NAME;
    public oAuthScopes = 'workout'; // Original value from OAuth2.ts

    getOAuth2Client(refresh = false): AuthorizationCode {
        return COROSAPIAuth(refresh);
    }

    async getAuthorizationData(redirectUri: string, state: string): Promise<{ options: any; context?: any }> {
        return {
            options: {
                redirect_uri: redirectUri,
                scope: this.oAuthScopes,
                state: state,
            },
        };
    }

    getTokenRequestConfig(redirectUri: string, code: string, context?: any): any {
        return {
            code: code,
            scope: this.oAuthScopes,
            redirect_uri: redirectUri,
        };
    }

    convertTokenResponse(response: AccessToken, uniqueId?: string, extraData?: any): ServiceTokenInput & { openId: string } {
        const currentDate = new Date();
        // COROS returns 'openId' in user fetch, but maybe not in token response directly? 
        // OAuth2.ts implementation fetches it explicitly.
        // If uniqueId is passed (from processNewToken), use it.

        return {
            serviceName: this.serviceName,
            accessToken: response.token.access_token as string,
            refreshToken: response.token.refresh_token as string,
            tokenType: (response.token.token_type as string) || 'bearer',
            expiresAt: currentDate.getTime() + ((response.token as Record<string, unknown>).expires_in as number * 1000),
            scope: (response.token.scope as string) || this.oAuthScopes,
            openId: uniqueId as string, // Must be fetched via processNewToken
            dateCreated: currentDate.getTime(),
            dateRefreshed: currentDate.getTime(),
        };
    }

    async processNewToken(token: AccessToken, _userId: string): Promise<{ uniqueId?: string; permissions?: string[] }> {
        // COROS typically returns openId in the token response.
        // We prefer that to avoid an extra API call.
        const tokenOpenId = (token.token as Record<string, unknown>).openId as string | undefined;
        if (tokenOpenId) {
            return { uniqueId: tokenOpenId };
        }

        // Fallback: Fetch User ID from API if missing in token
        let uniqueId: string;
        try {
            uniqueId = await getCOROSUserId(token.token.access_token as string);
        } catch {
            throw new Error(`Failed to fetch COROS User ID for user ${_userId}`);
        }
        return { uniqueId };
    }

    async deauthorize(token: Auth2ServiceTokenInterface): Promise<void> {
        // Per COROS API Reference V2.0.6: POST https://open.coros.com/oauth2/deauthorize?token=xxxxxxxx
        await deauthorizeCOROSUser(token.accessToken);
    }

    getDuplicateConnectionQuery(externalUserId: string): admin.firestore.Query {
        return admin.firestore().collectionGroup('tokens')
            .where('openId', '==', externalUserId)
            .where('serviceName', '==', this.serviceName);
    }
}
