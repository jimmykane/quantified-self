import { ServiceNames } from '@sports-alliance/sports-lib';
import { COROSAPIAuth } from './coros/auth/auth';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { SuuntoAPIAuth } from './suunto/auth/auth';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from './coros/constants';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';
import { getTokenData } from './tokens';
import * as requestPromise from './request-helper';
import { config } from './config';
import { TokenNotFoundError } from './utils';

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
  const results: AccessToken = await serviceConfig.oauth2Client.getToken({
    code: code,
    scope: serviceConfig.oAuthScopes,
    redirect_uri: redirectUri,
  });


  if (!results || !results.token || !results.token.access_token) {
    logger.error(`Failed to get token results for ${serviceName}`, { results });
    throw new Error(`No results when geting token for userID: ${userID}, serviceName: ${serviceName}`);
  }

  await admin.firestore()
    .collection(serviceConfig.tokenCollectionName)
    .doc(userID).collection('tokens')
    .doc((results.token as any).user || (results.token as any).openId)// @todo make this dynamic and not silly like this
    .set(convertAccessTokenResponseToServiceToken(results, serviceName));
  logger.info(`User ${userID} successfully connected to ${serviceName}`);
}

export async function deauthorizeServiceForUser(userID: string, serviceName: ServiceNames) {
  const serviceConfig = getServiceConfig(serviceName);
  const userDocRef = admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID);
  const tokenQuerySnapshots = await userDocRef.collection('tokens').get();

  if (tokenQuerySnapshots.empty) {
    logger.warn(`No tokens found for user ${userID} in ${serviceConfig.tokenCollectionName}. Deleting parent document.`);
    await userDocRef.delete();
    throw new TokenNotFoundError('No tokens found');
  }

  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  let failedTokenCount = 0;

  // Deauthorize tokens individually.
  // We delete successful ones and preserve those that fail with 500.
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    let shouldDeleteToken = true;

    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, false);
    } catch (e: any) {
      const statusCode = e.statusCode || (e.output && e.output.statusCode);
      if (statusCode === 500) {
        logger.error(`Refreshing token failed with 500 for ${tokenQueryDocumentSnapshot.id}. Preserving local token.`);
        shouldDeleteToken = false;
        failedTokenCount++;
      } else {
        logger.warn(`Refreshing token failed for ${tokenQueryDocumentSnapshot.id} (${statusCode || 'unknown error'}). Proceeding with local cleanup.`);
      }
    }

    if (shouldDeleteToken && serviceToken) {
      switch (serviceName) {
        default:
          break;
        case ServiceNames.SuuntoApp:
          try {
            await requestPromise.get({
              headers: {
                'Authorization': `Bearer ${serviceToken.accessToken}`,
              },
              url: `https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=${config.suuntoapp.client_id}`,
            });
            logger.info(`Deauthorized token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
          } catch (apiError: any) {
            const statusCode = apiError.statusCode || (apiError.output && apiError.output.statusCode);
            if (statusCode === 500) {
              logger.error(`Suunto API deauthorization failed with 500 for ${userID}. Preserving local token.`);
              shouldDeleteToken = false;
              failedTokenCount++;
            } else {
              logger.warn(`Failed to deauthorize on Suunto API for ${userID}: ${apiError.message}. Proceeding with local cleanup.`);
            }
          }
          break;
      }
    }

    if (shouldDeleteToken) {
      try {
        await tokenQueryDocumentSnapshot.ref.delete();
        logger.info(`Deleted token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
      } catch (deleteError: any) {
        logger.error(`Failed to delete local token ${tokenQueryDocumentSnapshot.id}: ${deleteError.message}`);
        // If we can't delete it locally, effectively it failed to be cleaned up
        failedTokenCount++;
      }
    }
  }

  // Only delete the parent document if ALL tokens were successfully deleted
  if (failedTokenCount === 0) {
    await userDocRef.delete();
    logger.info(`Deleted parent document ${userID} from ${serviceConfig.tokenCollectionName}`);
  } else {
    logger.warn(`Skipping parent document deletion for ${userID} because ${failedTokenCount} tokens could not be safely deauthorized.`);
  }
}

export interface ServiceConfig {
  oauth2Client: AuthorizationCode,
  oAuthScopes: 'workout',
  tokenCollectionName: typeof SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME | typeof COROSAPI_ACCESS_TOKENS_COLLECTION_NAME
}
