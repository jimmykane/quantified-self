import { ServiceAuthAdapter, ServiceTokenInput } from '../../auth/ServiceAuthAdapter';
import { ServiceNames, Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from '../constants';
import { GarminAPIAuth } from './auth';
import { getGarminPermissions, getGarminUserId, deauthorizeGarminUser } from './api';

export interface GarminAPIAuth2ServiceTokenInterface extends Auth2ServiceTokenInterface {
    userID: string;
    permissions?: string[];
    permissionsLastChangedAt?: number;
}

export class GarminAuthAdapter implements ServiceAuthAdapter {
    public serviceName = ServiceNames.GarminAPI;
    public tokenCollectionName = GARMIN_API_TOKENS_COLLECTION_NAME;
    public oAuthScopes = 'PARTNER_WRITE PARTNER_READ CONNECT_READ CONNECT_WRITE';

    getOAuth2Client(refresh = false): AuthorizationCode {
        return GarminAPIAuth(refresh);
    }

    async getAuthorizationData(redirectUri: string, state: string): Promise<{ options: any; context?: any }> {
        // Generate PKCE Verifier and Challenge (S256)
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

        return {
            options: {
                redirect_uri: redirectUri,
                scope: this.oAuthScopes,
                state: state,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256',
            },
            context: {
                codeVerifier: codeVerifier,
            },
        };
    }


    getTokenRequestConfig(redirectUri: string, code: string, context?: any): any {
        if (!context || !context.codeVerifier) {
            throw new Error(`Garmin auth requires codeVerifier in context. State may be lost.`);
        }
        return {
            code: code,
            scope: this.oAuthScopes,
            redirect_uri: redirectUri,
            code_verifier: context.codeVerifier,
        };
    }

    convertTokenResponse(response: AccessToken, uniqueId?: string, extraData?: any): ServiceTokenInput & { userID: string; permissions?: string[]; permissionsLastChangedAt?: number } {
        const currentDate = new Date();
        const baseToken = {
            serviceName: this.serviceName,
            accessToken: response.token.access_token as string,
            refreshToken: response.token.refresh_token as string,
            tokenType: (response.token.token_type as string) || 'bearer',
            expiresAt: currentDate.getTime() + ((response.token as Record<string, unknown>).expires_in as number * 1000),
            scope: (response.token.scope as string) || 'workout',
            userID: uniqueId || (response.token as Record<string, unknown>).user as string, // This is the Garmin User ID
            dateCreated: currentDate.getTime(),
            dateRefreshed: currentDate.getTime(),
        };

        if (extraData?.permissions) {
            return {
                ...baseToken,
                permissions: extraData.permissions,
                permissionsLastChangedAt: Math.floor(Date.now() / 1000),
            };
        }

        return baseToken;
    }

    async processNewToken(token: AccessToken, userId: string): Promise<{ uniqueId?: string; permissions?: string[] }> {
        let uniqueId = (token.token as Record<string, unknown>).user as string | undefined || (token.token as Record<string, unknown>).openId as string | undefined;

        // Fetch User ID
        try {
            uniqueId = await getGarminUserId(token.token.access_token as string);
        } catch (e: any) {
            // Re-throw with context, though getGarminUserId logs internally too
            throw new Error(`Failed to fetch Garmin User ID for user ${userId}`);
        }

        // Fetch Permissions
        // We don't fail the flow if permissions fail, matching legacy behavior
        const permissions = await getGarminPermissions(token.token.access_token as string);

        return { uniqueId, permissions };
    }

    async deauthorize(token: Auth2ServiceTokenInterface): Promise<void> {
        const serviceToken = token as GarminAPIAuth2ServiceTokenInterface;
        await deauthorizeGarminUser(serviceToken.accessToken);
    }

    getDuplicateConnectionQuery(externalUserId: string): admin.firestore.Query {
        return admin.firestore().collectionGroup('tokens')
            .where('userID', '==', externalUserId)
            .where('serviceName', '==', this.serviceName); // Added explicit service check for safety
    }
}
