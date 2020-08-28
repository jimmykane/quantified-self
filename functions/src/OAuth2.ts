import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import { COROSAPIAuth } from './coros/auth/auth';
import * as crypto from "crypto";
import * as admin from 'firebase-admin';
import { SuuntoAPIAuth } from './suunto/auth/auth';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from './coros/constants';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import { Auth2ServiceTokenInterface } from '@sports-alliance/sports-lib/lib/service-tokens/oauth2-service-token.interface';
import { getTokenData } from './service-tokens';
import * as requestPromise from 'request-promise-native';
import * as functions from 'firebase-functions';

/**
 *
 * @param serviceName
 * @param useStaging
 */
export function getServiceConfig(serviceName: ServiceNames, useStaging = false): ServiceConfig {
  switch (serviceName) {
    default:
      throw new Error(`Not implemented`)
    case ServiceNames.SuuntoApp:
      return {
        oauth2Client: SuuntoAPIAuth(),
        oAuthScopes: 'workout',
        tokenCollectionName: SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME,
      }
    case ServiceNames.COROSAPI:
      return {
        oauth2Client: COROSAPIAuth(useStaging),
        oAuthScopes: 'workout',
        tokenCollectionName: COROSAPI_ACCESS_TOKENS_COLLECTION_NAME,
      }
  }
}

/**
 * This is used only for COROS and Suunto that implement oAuth2
 * @param userID
 * @param serviceName
 * @param redirectUri
 * @param useStaging
 */
export async function getServiceOAuth2CodeRedirectAndSaveStateToUser(userID: string, serviceName: ServiceNames, redirectUri: string, useStaging = false): Promise<string> {
  const serviceConfig = getServiceConfig(serviceName, useStaging)
  const state = crypto.randomBytes(20).toString('hex')
  const serviceRedirectURI = serviceConfig.oauth2Client.authorizeURL({
    redirect_uri: redirectUri,
    scope: serviceConfig.oAuthScopes,
    state: state
  });

  await admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID).set({
    state: state
  })

  return serviceRedirectURI
}

/**
 * Validates the state
 * @param userID
 * @param serviceName
 * @param state
 * @param useStaging
 */
export async function validateOAuth2State(userID: string, serviceName: ServiceNames, state: string, useStaging = false): Promise<boolean> {
  const tokensDocumentSnapshotData = (await admin.firestore().collection(getServiceConfig(serviceName, useStaging).tokenCollectionName).doc(userID).get()).data();
  return tokensDocumentSnapshotData && tokensDocumentSnapshotData.state && tokensDocumentSnapshotData.state === state
}

/**
 * Gets from the service the access token for a code and sets it for the user
 * @param userID
 * @param serviceName
 * @param redirectUri
 * @param code
 * @param useStaging
 */
export async function getAndSetServiceOAuth2AccessTokenForUser(userID: string, serviceName: ServiceNames, redirectUri: string, code: string, useStaging = false) {
  const serviceConfig = getServiceConfig(serviceName, useStaging)
  let results: AccessToken
  results = await serviceConfig.oauth2Client.getToken({
    code: code,
    scope: serviceConfig.oAuthScopes,
    // state: state,
    redirect_uri: redirectUri
  });


  if (!results) {
    throw new Error(`No results when geting token for userID: ${userID}, serviceName: ${serviceName} using staging ${useStaging}`)
  }

  const currentDate = new Date();

  await admin.firestore()
    .collection(serviceConfig.tokenCollectionName)
    .doc(userID).collection('tokens')
    .doc(results.token.user)
    .set(<Auth2ServiceTokenInterface>{
      accessToken: results.token.access_token,
      refreshToken: results.token.refresh_token,
      tokenType: results.token.token_type,
      expiresAt: currentDate.getTime() + (results.token.expires_in * 1000),
      scope: results.token.scope,
      userName: results.token.user,
      dateCreated: currentDate.getTime(),
      dateRefreshed: currentDate.getTime(),
    })
  console.log(`User ${userID} successfully connected to ${serviceName}`)
}

export async function deauthorizeServiceForUser(userID: string, serviceName: ServiceNames, useStaging = false){

  const tokenQuerySnapshots = await admin.firestore().collection('suuntoAppAccessTokens').doc(userID).collection('tokens').get();
  console.log(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  // Deauthorize all tokens for that user
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {

    let serviceToken;
    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, false, useStaging);
    } catch (e) {
      console.error(`Refreshing token failed skipping deletion for this token with id ${tokenQueryDocumentSnapshot.id}`);
      continue // Go to next
    }

    await requestPromise.get({
      headers: {
        'Authorization': `Bearer ${serviceToken.accessToken}`,
      },
      url: `https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=${functions.config().suuntoapp.client_id}`,
    });
    console.log(`Deauthorized token ${tokenQueryDocumentSnapshot.id} for ${userID}`)

    await tokenQueryDocumentSnapshot.ref.delete();

    console.log(`Deleted token ${tokenQueryDocumentSnapshot.id} for ${userID}`)


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
    // } catch (e) {
    //   console.error(`Could not delete token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
    //   throw e
    // }
    // console.log(`Deleted successfully token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
  }
}

export interface ServiceConfig {
  oauth2Client: AuthorizationCode,
  oAuthScopes: 'workout', // @todo add more
  tokenCollectionName: typeof SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME | typeof COROSAPI_ACCESS_TOKENS_COLLECTION_NAME
}
