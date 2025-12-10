import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { COROSAPIAuth } from './coros/auth/auth';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { SuuntoAPIAuth } from './suunto/auth/auth';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from './coros/constants';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
import { getTokenData } from './tokens';
import * as requestPromise from './request-helper';
import * as functions from 'firebase-functions';

/**
 *
 * @param serviceName
 * @param refresh
 */
export function getServiceConfig(serviceName: ServiceNames, refresh = false): ServiceConfig {
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.SuuntoApp:
      return {
        oauth2Client: SuuntoAPIAuth(),
        oAuthScopes: 'workout',
        tokenCollectionName: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME,
      };
    case ServiceNames.COROSAPI:
      return {
        oauth2Client: COROSAPIAuth(refresh),
        oAuthScopes: 'workout',
        tokenCollectionName: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME,
      };
  }
}

/**
 * This is used only for COROS and Suunto that implement oAuth2
 * @param userID
 * @param serviceName
 * @param redirectUri
 */
export async function getServiceOAuth2CodeRedirectAndSaveStateToUser(userID: string, serviceName: ServiceNames, redirectUri: string): Promise<string> {
  const serviceConfig = getServiceConfig(serviceName);
  const state = crypto.randomBytes(20).toString('hex');
  const serviceRedirectURI = serviceConfig.oauth2Client.authorizeURL({
    redirect_uri: redirectUri,
    scope: serviceConfig.oAuthScopes,
    state: state,
  });

  await admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID).set({
    state: state,
  });

  return serviceRedirectURI;
}

/**
 * Validates the state
 * @param userID
 * @param serviceName
 * @param state
 */
export async function validateOAuth2State(userID: string, serviceName: ServiceNames, state: string): Promise<boolean> {
  const tokensDocumentSnapshotData = (await admin.firestore().collection(getServiceConfig(serviceName).tokenCollectionName).doc(userID).get()).data();
  return tokensDocumentSnapshotData && tokensDocumentSnapshotData.state && tokensDocumentSnapshotData.state === state;
}

export function convertAccessTokenResponseToServiceToken(response: AccessToken, serviceName: ServiceNames): SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface {
  const currentDate = new Date();
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.SuuntoApp:
      return <SuuntoAPIAuth2ServiceTokenInterface>{
        serviceName: serviceName,
        accessToken: response.token.access_token,
        refreshToken: response.token.refresh_token,
        tokenType: response.token.token_type,
        expiresAt: currentDate.getTime() + ((response.token as any).expires_in * 1000),
        scope: response.token.scope,
        userName: (response.token as any).user,
        dateCreated: currentDate.getTime(),
        dateRefreshed: currentDate.getTime(),
      };
    case ServiceNames.COROSAPI:
      return <COROSAPIAuth2ServiceTokenInterface>{
        serviceName: serviceName,
        accessToken: response.token.access_token,
        refreshToken: response.token.refresh_token,
        tokenType: response.token.token_type || 'bearer',
        expiresAt: currentDate.getTime() + ((response.token as any).expires_in * 1000),
        scope: response.token.scope || 'workout',
        openId: (response.token as any).openId,
        dateCreated: currentDate.getTime(),
        dateRefreshed: currentDate.getTime(),
      };
  }
}

/**
 * Gets from the service the access token for a code and sets it for the user
 * @param userID
 * @param serviceName
 * @param redirectUri
 * @param code
 */
export async function getAndSetServiceOAuth2AccessTokenForUser(userID: string, serviceName: ServiceNames, redirectUri: string, code: string) {
  const serviceConfig = getServiceConfig(serviceName);
  let results: AccessToken;
  results = await serviceConfig.oauth2Client.getToken({
    code: code,
    scope: serviceConfig.oAuthScopes,
    redirect_uri: redirectUri,
  });


  if (!results || !results.token || !results.token.access_token) {
    throw new Error(`No results when geting token for userID: ${userID}, serviceName: ${serviceName}`);
  }

  await admin.firestore()
    .collection(serviceConfig.tokenCollectionName)
    .doc(userID).collection('tokens')
    .doc((results.token as any).user || (results.token as any).openId)// @todo make this dynamic and not silly like this
    .set(convertAccessTokenResponseToServiceToken(results, serviceName));
  console.log(`User ${userID} successfully connected to ${serviceName}`);
}

export async function deauthorizeServiceForUser(userID: string, serviceName: ServiceNames) {
  const serviceConfig = getServiceConfig(serviceName);
  const tokenQuerySnapshots = await admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID).collection('tokens').get();
  console.log(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  // Deauthorize all tokens for that user
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, false);
    } catch (e: any) {
      console.error(`Refreshing token failed skipping deletion for this token with id ${tokenQueryDocumentSnapshot.id}`);
      continue; // Go to next
    }

    switch (serviceName) {
      default:
        break;
      case ServiceNames.SuuntoApp:
        await requestPromise.get({
          headers: {
            'Authorization': `Bearer ${serviceToken.accessToken}`,
          },
          url: `https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=${functions.config().suuntoapp.client_id}`,
        });
        console.log(`Deauthorized token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
        break;
    }

    await tokenQueryDocumentSnapshot.ref.delete();

    console.log(`Deleted token ${tokenQueryDocumentSnapshot.id} for ${userID}`);


    // // If a user has used 2 accounts to connect to the same
    // // Now get from all users the same username token
    // // Note this will return the current doc as well
    // const otherUsersTokensQuerySnapshot = await admin.firestore().collectionGroup('tokens').where("userName", "==", serviceToken.userName).get();
    //
    // console.log(`Found ${otherUsersTokensQuerySnapshot.size} tokens for token username ${serviceToken.userName}`);
    //
    // try {
    //   for (const otherUserQueryDocumentSnapshot of otherUsersTokensQuerySnapshot.docs) {
    //     await otherUserQueryDocumentSnapshot.ref.delete();
    //     console.log(`Deleted token ${otherUserQueryDocumentSnapshot.id}`);
    //   }
    // } catch (e: any) {
    //   console.error(`Could not delete token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
    //   throw e
    // }
    // console.log(`Deleted successfully token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
  }
}

export interface ServiceConfig {
  oauth2Client: AuthorizationCode,
  oAuthScopes: 'workout',
  tokenCollectionName: typeof SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME | typeof COROSAPI_ACCESS_TOKENS_COLLECTION_NAME
}
