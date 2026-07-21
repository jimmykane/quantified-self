import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import {
  Auth2ServiceTokenInterface,
  ServiceNames,
} from '@sports-alliance/sports-lib';
import { ServiceAuthAdapter, ServiceTokenInput } from '../../auth/ServiceAuthAdapter';
import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../../shared/user-deletion-guard';
import {
  WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME,
  WAHOO_API_SCOPES,
  WAHOO_API_USER_MAPPINGS_COLLECTION_NAME,
} from '../constants';
import { WahooAPIAuth } from './auth';
import { deauthorizeWahooUser, getWahooUserID } from './api';

export class WahooAuthAdapter implements ServiceAuthAdapter {
  public serviceName = ServiceNames.WahooAPI;
  public tokenCollectionName = WAHOO_API_ACCESS_TOKENS_COLLECTION_NAME;
  public oAuthScopes = WAHOO_API_SCOPES;
  public managesDuplicateConnections = true;

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

  async onTokenPersisted(userId: string, externalUserId: string): Promise<{ previousOwnerUserID?: string }> {
    const db = admin.firestore();
    const mappingRef = db.collection(WAHOO_API_USER_MAPPINGS_COLLECTION_NAME).doc(externalUserId);
    const previousOwnerUserID = await db.runTransaction(async (transaction) => {
      let deletionGuard;
      try {
        deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userId);
      } catch (error) {
        throw new UserDeletionGuardReadError(userId, 'wahoo_identity_mapping', error);
      }
      if (deletionGuard.shouldSkip) {
        throw new Error('Cannot persist a Wahoo identity mapping while account deletion is in progress.');
      }

      const snapshot = await transaction.get(mappingRef);
      const existingOwner = snapshot.exists ? `${snapshot.data()?.firebaseUserID || ''}` : '';
      transaction.set(mappingRef, {
        firebaseUserID: userId,
        wahooUserID: externalUserId,
        serviceName: this.serviceName,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return existingOwner && existingOwner !== userId ? existingOwner : undefined;
    });
    return { previousOwnerUserID };
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
