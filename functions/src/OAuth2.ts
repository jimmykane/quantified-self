import { ServiceNames } from '@sports-alliance/sports-lib';
import { AccessToken } from 'simple-oauth2';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  Auth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';


import { getTokenData } from './tokens';
import { TokenNotFoundError } from './utils';
import { getServiceAdapter } from './auth/factory';


export async function removeDuplicateConnections(currentUserID: string, serviceName: ServiceNames, externalUserId: string) {
  const adapter = getServiceAdapter(serviceName);
  const query: admin.firestore.Query = adapter.getDuplicateConnectionQuery(externalUserId);

  const snapshot = await query.get();

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
      // Use deleteLocalServiceToken to also clean up parent document if this was the last token
      await deleteLocalServiceToken(otherUserId, serviceName, doc.id);
      deleteCount++;
    }
  }

  if (deleteCount > 0) {
    logger.info(`Removed ${deleteCount} stale connections for ${serviceName} account ${externalUserId}.`);
  }
}

/**
 *
 * @param serviceName
 * @param refresh
 * @deprecated Use getServiceAdapter instead
 */
export function getServiceConfig(serviceName: ServiceNames, refresh = false): { oauth2Client: any, oAuthScopes: string, tokenCollectionName: string } {
  const adapter = getServiceAdapter(serviceName, refresh);
  return {
    oauth2Client: adapter.getOAuth2Client(refresh),
    oAuthScopes: adapter.oAuthScopes,
    tokenCollectionName: adapter.tokenCollectionName,
  };
}


/**
 * This is used for all services that implement oAuth2
 * @param userID
 * @param serviceName
 * @param redirectUri
 */
export async function getServiceOAuth2CodeRedirectAndSaveStateToUser(userID: string, serviceName: ServiceNames, redirectUri: string): Promise<string> {
  const adapter = getServiceAdapter(serviceName);
  const state = crypto.randomBytes(20).toString('hex');

  const { options, context } = await adapter.getAuthorizationData(redirectUri, state);

  const oauth2Client = adapter.getOAuth2Client();
  const serviceRedirectURI = oauth2Client.authorizeURL(options);

  const tokenData: any = {
    state: state,
    ...(context || {}),
  };

  await admin.firestore().collection(adapter.tokenCollectionName).doc(userID).set(tokenData, { merge: true });

  return serviceRedirectURI;
}

/**
 * Validates the state
 * @param userID
 * @param serviceName
 * @param state
 */
export async function validateOAuth2State(userID: string, serviceName: ServiceNames, state: string): Promise<boolean> {
  const adapter = getServiceAdapter(serviceName);
  const tokensDocumentSnapshot = await admin.firestore().collection(adapter.tokenCollectionName).doc(userID).get();
  const tokensDocumentSnapshotData = tokensDocumentSnapshot.data ? tokensDocumentSnapshot.data() : undefined;
  return !!(tokensDocumentSnapshotData && tokensDocumentSnapshotData.state && tokensDocumentSnapshotData.state === state);
}

/**
 * This is used for all services that implement oAuth2
 * @param response
 * @param serviceName
 * @param uniqueId
 */
export function convertAccessTokenResponseToServiceToken(response: AccessToken, serviceName: ServiceNames, uniqueId?: string): Auth2ServiceTokenInterface {
  const adapter = getServiceAdapter(serviceName);
  return adapter.convertTokenResponse(response, uniqueId) as unknown as Auth2ServiceTokenInterface;
}

/**
 * Gets from the service the access token for a code and sets it for the user
 * @param userID
 * @param serviceName
 * @param redirectUri
 * @param code
 */
export async function getAndSetServiceOAuth2AccessTokenForUser(userID: string, serviceName: ServiceNames, redirectUri: string, code: string) {
  const adapter = getServiceAdapter(serviceName);

  // Retrieve stored flow context (state, PKCE verifier, etc)
  const tokensDocumentSnapshot = await admin.firestore().collection(adapter.tokenCollectionName).doc(userID).get();
  const tokensDocumentSnapshotData = tokensDocumentSnapshot.data ? tokensDocumentSnapshot.data() : undefined;

  try {
    const tokenConfig = adapter.getTokenRequestConfig(redirectUri, code, tokensDocumentSnapshotData);

    const oauth2Client = adapter.getOAuth2Client();
    const results: AccessToken = await oauth2Client.getToken(tokenConfig);

    if (!results || !results.token || !results.token.access_token) {
      logger.error(`Failed to get token results for ${serviceName}`, { results });
      throw new Error(`No results when geting token for userID: ${userID}, serviceName: ${serviceName}`);
    }

    // Use adapter to process post-token logic (fetch uniqueId, permissions, etc)
    const processedTokenData = await adapter.processNewToken(results, userID);
    const { uniqueId } = processedTokenData;

    const tokenData = adapter.convertTokenResponse(results, uniqueId, processedTokenData);

    await admin.firestore()
      .collection(adapter.tokenCollectionName)
      .doc(userID).collection('tokens')
      .doc(uniqueId || 'default')
      .set(tokenData);

    // Remove any OTHER users connected to this same external account
    if (uniqueId) {
      try {
        await removeDuplicateConnections(userID, serviceName, uniqueId);
      } catch (e) {
        logger.error(`Failed to cleanup duplicate connections for ${userID}`, e);
        // Don't fail the auth flow for this, just log
      }
    }

    logger.info(`User ${userID} successfully connected to ${serviceName}`);
  } finally {
    // Cleanup temporary fields (state, PKCE verifier)
    try {
      await admin.firestore().collection(adapter.tokenCollectionName).doc(userID).update({
        state: admin.firestore.FieldValue.delete(),
        codeVerifier: admin.firestore.FieldValue.delete(),
      });
      logger.info(`Cleaned up temporary OAuth2 data for User ${userID} and ${serviceName}`);
    } catch (e) {
      // Don't fail if cleanup fails, but log it
      logger.warn(`Failed to cleanup temporary OAuth2 data for user ${userID}`, e);
    }
  }
}

export async function deauthorizeServiceForUser(userID: string, serviceName: ServiceNames) {
  const adapter = getServiceAdapter(serviceName);
  const userDocRef = admin.firestore().collection(adapter.tokenCollectionName).doc(userID);
  const tokenQuerySnapshots = await userDocRef.collection('tokens').get();


  if (tokenQuerySnapshots.empty) {
    logger.warn(`No tokens found for user ${userID} in ${adapter.tokenCollectionName}. Cleaning up abandoned data.`);
    await admin.firestore().recursiveDelete(userDocRef);
    throw new TokenNotFoundError('No tokens found');
  }

  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  // Deauthorize tokens individually.
  // We delete successful ones and preserve those that fail with 500.
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let serviceToken;
    let shouldDeleteToken = true;

    try {
      serviceToken = await getTokenData(tokenQueryDocumentSnapshot, serviceName, false);
    } catch (e: any) {
      const statusCode = e.statusCode || (e.output && e.output.statusCode);
      if (statusCode === 500 || statusCode === 502) {
        logger.error(`Refreshing token failed with ${statusCode} for ${tokenQueryDocumentSnapshot.id}. Preserving local token.`);
        shouldDeleteToken = false;
      } else {
        logger.warn(`Refreshing token failed for ${tokenQueryDocumentSnapshot.id} (${statusCode || 'unknown error'}). Proceeding with local cleanup.`);
      }
    }

    if (shouldDeleteToken && serviceToken) {
      try {
        await adapter.deauthorize(serviceToken);
        logger.info(`Deauthorized ${serviceName} token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
      } catch (apiError: any) {
        const statusCode = apiError.statusCode || (apiError.output && apiError.output.statusCode);
        if (statusCode === 500 || statusCode === 502) {
          logger.error(`${serviceName} API deauthorization failed with ${statusCode} for ${userID}. Preserving local token.`);
          shouldDeleteToken = false;
        } else {
          logger.warn(`Failed to deauthorize on ${serviceName} API for ${userID}: ${apiError.message}. Proceeding with local cleanup.`);
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
  logger.info(`Starting delete for local token ${tokenID} for ${userID} and serviceName ${serviceName}`);
  const adapter = getServiceAdapter(serviceName);
  const userDocRef = admin.firestore().collection(adapter.tokenCollectionName).doc(userID);

  await userDocRef.collection('tokens').doc(tokenID).delete();
  // Check if any tokens remain
  const remainingTokens = await userDocRef.collection('tokens').limit(1).get();
  logger.info(`Remaining tokens for ${userID}: ${remainingTokens.size}`);
  if (remainingTokens.empty) {
    logger.info(`No remaining tokens for ${userID}. Deleting parent document and all descendant data (surgical).`);
    await admin.firestore().recursiveDelete(userDocRef);
  }
}

