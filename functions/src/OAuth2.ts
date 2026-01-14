import { ServiceNames } from '@sports-alliance/sports-lib';
import { COROSAPIAuth } from './coros/auth/auth';
import { GarminAPIAuth } from './garmin/auth/auth';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { SuuntoAPIAuth } from './suunto/auth/auth';
import { SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME } from './suunto/constants';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from './coros/constants';
import { GARMIN_API_TOKENS_COLLECTION_NAME } from './garmin/constants';
import { AccessToken, AuthorizationCode } from 'simple-oauth2';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
  Auth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';

export interface GarminAPIAuth2ServiceTokenInterface extends Auth2ServiceTokenInterface {
  userID: string;
  permissions?: string[];
  permissionsLastChangedAt?: number;
}
import { getGarminUserId, getGarminPermissions } from './garmin/auth/api';
import { getTokenData } from './tokens';
import * as requestPromise from './request-helper';
import { config } from './config';
import { TokenNotFoundError } from './utils';

async function removeDuplicateConnections(currentUserID: string, serviceName: ServiceNames, externalUserId: string) {
  let query: admin.firestore.Query = admin.firestore().collectionGroup('tokens');

  // Choose the correct field based on service
  if (serviceName === ServiceNames.SuuntoApp) {
    query = query.where('userName', '==', externalUserId);
  } else if (serviceName === ServiceNames.COROSAPI) {
    query = query.where('openId', '==', externalUserId);
  } else if (serviceName === ServiceNames.GarminAPI) {
    // Garmin stores "userId" in the token doc (merged from /user/id endpoint or token response)
    query = query.where('userID', '==', externalUserId);
  } else {
    return;
  }

  const snapshot = await query.get();

  const batch = admin.firestore().batch();
  let deleteCount = 0;

  for (const doc of snapshot.docs) {
    // The path is {ServiceCollection}/{UserID}/tokens/{TokenID}
    // doc.ref.parent is 'tokens' collection
    // doc.ref.parent.parent is {UserID} document
    const otherUserId = doc.ref.parent.parent?.id;

    // Also check serviceName to be sure (though field filter implies it, other services might use same field names eventually)
    const data = doc.data();
    if (data.serviceName !== serviceName) {
      continue;
    }

    if (otherUserId && otherUserId !== currentUserID) {
      logger.warn(`Found duplicate connection for ${serviceName} account ${externalUserId}. Connected to User ${otherUserId}, but now User ${currentUserID} is connecting. Deleting old token ${doc.id} for User ${otherUserId}.`);
      batch.delete(doc.ref);
      deleteCount++;

      // We should also check if we need to delete the parent document (User ID doc) if this was the last token.
      // However, we can't know for sure in a batch content without reading again.
      // But usually we can add a check or just assume if we delete the token, we might leave a hollow parent.
      // The manual Deauthorize logic checks `tokenQuerySnapshots.empty`.
      // Here, we can't easily do it inside the batch loop efficiently without N extra reads.
      // Given this is an edge case (duplicate takeover), leaving a hollow parent doc is acceptable for now.
      // The parent doc has no data, it's just a folder in Firestore UI, unless it has fields.
      // In OAuth2.ts, line 58, we set `state` on the parent doc. So it's not empty.
      // So we should NOT delete the parent doc blindly.
      // Ideally, we would want to cleanup strictly, but let's stick to deleting the token for now 
      // to avoid complex race conditions or extra reads. 
      // The user asked "are you deleting the parent user document".
      // If I WANT to delete it, I need to know if it has other tokens.
    }
  }

  if (deleteCount > 0) {
    await batch.commit();
    logger.info(`Removed ${deleteCount} stale connections for ${serviceName} account ${externalUserId}.`);
  }
}

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
    case ServiceNames.GarminAPI:
      return {
        oauth2Client: GarminAPIAuth(refresh),
        oAuthScopes: 'PARTNER_WRITE PARTNER_READ CONNECT_READ CONNECT_WRITE',
        tokenCollectionName: GARMIN_API_TOKENS_COLLECTION_NAME,
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

  // PKCE Setup for Garmin
  let codeVerifier: string | undefined;
  let codeChallenge: string | undefined;

  if (serviceName === ServiceNames.GarminAPI) {
    // Generate PKCE Verifier and Challenge (S256)
    codeVerifier = crypto.randomBytes(32).toString('base64url');
    codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  const authorizationOptions: any = {
    redirect_uri: redirectUri,
    scope: serviceConfig.oAuthScopes,
    state: state,
  };

  if (codeChallenge) {
    authorizationOptions.code_challenge = codeChallenge;
    authorizationOptions.code_challenge_method = 'S256';
  }

  const serviceRedirectURI = serviceConfig.oauth2Client.authorizeURL(authorizationOptions);

  await admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID).set({
    state: state,
    ...(codeVerifier ? { codeVerifier } : {}),
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

export function convertAccessTokenResponseToServiceToken(response: AccessToken, serviceName: ServiceNames, uniqueId?: string): SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface | GarminAPIAuth2ServiceTokenInterface {
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
        userName: uniqueId || (response.token as any).user,
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
        openId: uniqueId || (response.token as any).openId,
        dateCreated: currentDate.getTime(),
        dateRefreshed: currentDate.getTime(),
      };
    case ServiceNames.GarminAPI:
      return <GarminAPIAuth2ServiceTokenInterface>{
        serviceName: serviceName,
        accessToken: response.token.access_token,
        refreshToken: response.token.refresh_token,
        tokenType: response.token.token_type || 'bearer',
        expiresAt: currentDate.getTime() + ((response.token as any).expires_in * 1000),
        scope: response.token.scope || 'workout',
        userID: uniqueId || (response.token as any).user, // This is the Garmin User ID
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

  // Check for PKCE Verifier
  let codeVerifier: string | undefined;
  if (serviceName === ServiceNames.GarminAPI) {
    const tokensDocumentSnapshotData = (await admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID).get()).data();
    if (tokensDocumentSnapshotData && tokensDocumentSnapshotData.codeVerifier) {
      codeVerifier = tokensDocumentSnapshotData.codeVerifier;
    }
  }

  const tokenConfig: any = {
    code: code,
    scope: serviceConfig.oAuthScopes,
    redirect_uri: redirectUri,
  };

  if (codeVerifier) {
    tokenConfig.code_verifier = codeVerifier;
  }

  const results: AccessToken = await serviceConfig.oauth2Client.getToken(tokenConfig);


  if (!results || !results.token || !results.token.access_token) {
    logger.error(`Failed to get token results for ${serviceName}`, { results });
    throw new Error(`No results when geting token for userID: ${userID}, serviceName: ${serviceName}`);
  }

  // Fetch User ID for Garmin if needed
  // Note: We use this ID to detect duplicate connections (Last One Wins policy).
  // If this same Garmin User ID is found on another Firebase User, we remove it there.
  let uniqueId = (results.token as any).user || (results.token as any).openId;
  if (serviceName === ServiceNames.GarminAPI) {
    try {
      uniqueId = await getGarminUserId(results.token.access_token as string);
    } catch (e: any) {
      // Error is already logged in utils, but we throw here to stop the flow
      throw new Error(`Failed to fetch Garmin User ID for user ${userID}`);
    }
  }

  // Fetch Permissions for Garmin
  let permissions: string[] | undefined;
  if (serviceName === ServiceNames.GarminAPI) {
    permissions = await getGarminPermissions(results.token.access_token as string);
  }

  const tokenData = convertAccessTokenResponseToServiceToken(results, serviceName, uniqueId);
  if (serviceName === ServiceNames.GarminAPI && permissions) {
    (tokenData as GarminAPIAuth2ServiceTokenInterface).permissions = permissions;
    (tokenData as GarminAPIAuth2ServiceTokenInterface).permissionsLastChangedAt = Math.floor(Date.now() / 1000);
  }

  await admin.firestore()
    .collection(serviceConfig.tokenCollectionName)
    .doc(userID).collection('tokens')
    .doc(uniqueId)// @todo make this dynamic and not silly like this
    .set(tokenData);

  // Remove any OTHER users connected to this same external account
  const externalUserId = uniqueId;
  if (externalUserId) {
    try {
      await removeDuplicateConnections(userID, serviceName, externalUserId);
    } catch (e) {
      logger.error(`Failed to cleanup duplicate connections for ${userID}`, e);
      // Don't fail the auth flow for this, just log
    }
  }

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
      let deauthorizationRequest;

      switch (serviceName) {
        default:
          break;
        case ServiceNames.COROSAPI:
          // Per COROS API Reference V2.0.6: POST https://open.coros.com/oauth2/deauthorize?token=xxxxxxxx
          deauthorizationRequest = requestPromise.post({
            url: `https://open.coros.com/oauth2/deauthorize?token=${serviceToken.accessToken}`,
          });
          break;
        case ServiceNames.SuuntoApp:
          deauthorizationRequest = requestPromise.get({
            headers: {
              'Authorization': `Bearer ${serviceToken.accessToken}`,
            },
            url: `https://cloudapi-oauth.suunto.com/oauth/deauthorize?client_id=${config.suuntoapp.client_id}`,
          });
          break;
        case ServiceNames.GarminAPI:
          // Per PDF: DELETE https://apis.garmin.com/wellness-api/rest/user/registration
          deauthorizationRequest = requestPromise.delete({
            headers: {
              'Authorization': `Bearer ${serviceToken.accessToken}`,
            },
            url: 'https://apis.garmin.com/wellness-api/rest/user/registration',
          });
          break;
      }

      if (deauthorizationRequest) {
        try {
          await deauthorizationRequest;
          logger.info(`Deauthorized ${serviceName} token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
        } catch (apiError: any) {
          const statusCode = apiError.statusCode || (apiError.output && apiError.output.statusCode);
          if (statusCode === 500) {
            logger.error(`${serviceName} API deauthorization failed with 500 for ${userID}. Preserving local token.`);
            shouldDeleteToken = false;
            failedTokenCount++;
          } else {
            logger.warn(`Failed to deauthorize on ${serviceName} API for ${userID}: ${apiError.message}. Proceeding with local cleanup.`);
          }
        }
      }
    }

    if (shouldDeleteToken) {
      try {
        await deleteLocalServiceToken(userID, serviceName, tokenQueryDocumentSnapshot.id);
      } catch (deleteError: any) {
        logger.error(`Failed to delete local token ${tokenQueryDocumentSnapshot.id}: ${deleteError.message}`);
      }
    }
  }
}

export async function deleteLocalServiceToken(userID: string, serviceName: ServiceNames, tokenID: string) {
  const serviceConfig = getServiceConfig(serviceName);
  const userDocRef = admin.firestore().collection(serviceConfig.tokenCollectionName).doc(userID);

  await userDocRef.collection('tokens').doc(tokenID).delete();

  // Check if any tokens remain
  const remainingTokens = await userDocRef.collection('tokens').limit(1).get();
  if (remainingTokens.empty) {
    await userDocRef.delete();
  }
}

export interface ServiceConfig {
  oauth2Client: AuthorizationCode,
  oAuthScopes: string,
  tokenCollectionName: typeof SUUNTOAPP_ACCESS_TOKENS_COLLECTION_NAME | typeof COROSAPI_ACCESS_TOKENS_COLLECTION_NAME | typeof GARMIN_API_TOKENS_COLLECTION_NAME
}
