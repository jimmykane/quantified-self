import * as admin from 'firebase-admin';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import {
  Auth2ServiceTokenInterface,
  ServiceNames,
} from '@sports-alliance/sports-lib';
import {
  ServiceAuthAdapter,
  ServiceTokenInput,
} from '../../auth/ServiceAuthAdapter';
import {
  WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
  WAHOO_API_SCOPES,
} from '../constants';
import { WahooAPIAuth } from './auth';
import { deauthorizeWahooUser, getWahooUserID } from './api';

export class WahooAuthAdapter implements ServiceAuthAdapter {
  public serviceName = ServiceNames.WahooAPI;
  public tokenCollectionName = WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME;
  public oAuthScopes = WAHOO_API_SCOPES;

  getOAuth2Client(): AuthorizationCode {
    return WahooAPIAuth();
  }

  async getAuthorizationData(redirectUri: string, state: string) {
    return {
      options: {
        redirect_uri: redirectUri,
        scope: this.oAuthScopes,
        state,
      },
    };
  }

  getTokenRequestConfig(redirectUri: string, code: string) {
    return {
      code,
      redirect_uri: redirectUri,
      scope: this.oAuthScopes,
    };
  }

  convertTokenResponse(response: AccessToken, uniqueId?: string): ServiceTokenInput & { wahooUserID: string } {
    const now = Date.now();
    const expiresInSeconds = Number(response.token.expires_in || 0);
    return {
      serviceName: this.serviceName,
      accessToken: `${response.token.access_token || ''}`,
      refreshToken: `${response.token.refresh_token || ''}`,
      tokenType: `${response.token.token_type || 'bearer'}`,
      expiresAt: now + Math.max(0, expiresInSeconds * 1000),
      scope: `${response.token.scope || this.oAuthScopes}`,
      wahooUserID: `${uniqueId || ''}`,
      dateCreated: now,
      dateRefreshed: now,
    };
  }

  async processNewToken(token: AccessToken): Promise<{ uniqueId?: string }> {
    return { uniqueId: await getWahooUserID(`${token.token.access_token || ''}`) };
  }

  async deauthorize(token: Auth2ServiceTokenInterface): Promise<void> {
    await deauthorizeWahooUser(token.accessToken);
  }

  getDuplicateConnectionQuery(externalUserId: string): admin.firestore.Query {
    return admin.firestore().collectionGroup('tokens')
      .where('wahooUserID', '==', externalUserId)
      .where('serviceName', '==', this.serviceName);
  }
}
