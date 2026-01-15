import { ServiceAuthAdapter, ServiceTokenInput } from '../../auth/ServiceAuthAdapter';
import { ServiceNames, Auth2ServiceTokenInterface, SuuntoAPIAuth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import * as admin from 'firebase-admin';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from '../constants';
import { SuuntoAPIAuth } from './auth';
import { deauthorizeSuuntoUser } from './api';

export class SuuntoAuthAdapter implements ServiceAuthAdapter {
    public serviceName = ServiceNames.SuuntoApp;
    public tokenCollectionName = SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME;
    public oAuthScopes = 'workout';

    getOAuth2Client(_refresh = false): AuthorizationCode {
        return SuuntoAPIAuth();
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

    convertTokenResponse(response: AccessToken, uniqueId?: string, extraData?: any): ServiceTokenInput & { userName: string } {
        const currentDate = new Date();
        const userIdFromToken = (response.token as Record<string, unknown>).user as string;

        return {
            serviceName: this.serviceName,
            accessToken: response.token.access_token as string,
            refreshToken: response.token.refresh_token as string,
            tokenType: (response.token.token_type as string) || 'bearer',
            expiresAt: currentDate.getTime() + ((response.token as Record<string, unknown>).expires_in as number * 1000),
            scope: (response.token.scope as string) || this.oAuthScopes,
            userName: uniqueId || userIdFromToken,
            dateCreated: currentDate.getTime(),
            dateRefreshed: currentDate.getTime(),
        };
    }

    async processNewToken(token: AccessToken, userId: string): Promise<{ uniqueId?: string; permissions?: string[] }> {
        const uniqueId = (token.token as any).user;
        return { uniqueId };
    }

    async deauthorize(token: Auth2ServiceTokenInterface): Promise<void> {
        const serviceToken = token as SuuntoAPIAuth2ServiceTokenInterface;
        await deauthorizeSuuntoUser(serviceToken.accessToken);
    }

    getDuplicateConnectionQuery(externalUserId: string): admin.firestore.Query {
        return admin.firestore().collectionGroup('tokens')
            .where('userName', '==', externalUserId)
            .where('serviceName', '==', this.serviceName);
    }
}
