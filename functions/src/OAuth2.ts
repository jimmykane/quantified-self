import { ServiceNames } from '@sports-alliance/sports-lib';
import { AccessToken } from 'simple-oauth2';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  Auth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';


import { getTokenData } from './tokens';
import { getServiceAdapter } from './auth/factory';
import { markServiceConnected } from './service-connection-meta';
import {
  cleanupServiceConnectionForUser,
  cleanupServiceTokenById,
  MissingTokensBehavior,
  SERVICE_AUTH_CLEANUP_REASONS,
} from './service-auth-lifecycle';
import { clearServiceDisconnectPending } from './service-disconnect-pending';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardState,
  UserDeletionGuardReadError,
} from './shared/user-deletion-guard';
import { archiveOrphanedServiceToken } from './orphaned-service-tokens';
export { deleteLocalServiceToken } from './service-token-store';

class OAuthServiceConnectionSkippedForDeletedUserError extends Error {
  public readonly name = 'OAuthServiceConnectionSkippedForDeletedUserError';
  public readonly code = 'failed-precondition';
  public readonly statusCode = 412;

  constructor(
    public readonly userID: string,
    public readonly serviceName: ServiceNames,
    public readonly phase: string,
  ) {
    super(`Skipping ${serviceName} OAuth write for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
  }
}

async function assertOAuthUserCanWriteServiceState(
  userID: string,
  serviceName: ServiceNames,
  phase: string,
): Promise<void> {
  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, phase, error);
  }

  if (deletionGuard.shouldSkip) {
    logger.warn(`Skipping ${serviceName} OAuth state write for user ${userID} during ${phase} because the user is missing or deletion is in progress.`);
    throw new OAuthServiceConnectionSkippedForDeletedUserError(userID, serviceName, phase);
  }
}

async function setOAuthStateIfUserActive(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
  tokenData: Record<string, unknown>,
): Promise<void> {
  const db = admin.firestore();
  const tokenRootRef = db.collection(tokenCollectionName).doc(userID);
  await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `oauth_state_write:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) {
      logger.warn(`Skipping ${serviceName} OAuth state write for user ${userID} because the user is missing or deletion is in progress.`);
      throw new OAuthServiceConnectionSkippedForDeletedUserError(userID, serviceName, `oauth_state_write:${serviceName}`);
    }
    transaction.set(tokenRootRef, tokenData, { merge: true });
  });
}

async function setOAuthTokenIfUserActive(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
  tokenID: string,
  tokenData: Record<string, unknown>,
): Promise<void> {
  const db = admin.firestore();
  const tokenDocRef = db.collection(tokenCollectionName).doc(userID).collection('tokens').doc(tokenID);
  await db.runTransaction(async (transaction) => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `oauth_token_write:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) {
      logger.warn(`Skipping ${serviceName} OAuth token write for user ${userID} because the user is missing or deletion is in progress.`);
      throw new OAuthServiceConnectionSkippedForDeletedUserError(userID, serviceName, `oauth_token_write:${serviceName}`);
    }
    transaction.set(tokenDocRef, tokenData);
  });
}

async function cleanupOAuthFlowContext(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
  tokenPersisted: boolean,
): Promise<void> {
  const db = admin.firestore();
  const tokenRootRef = db.collection(tokenCollectionName).doc(userID);
  let deletionGuard: UserDeletionGuardState;

  try {
    deletionGuard = await getUserDeletionGuardState(db, userID);
  } catch (error) {
    throw new UserDeletionGuardReadError(userID, `oauth_context_cleanup:${serviceName}`, error);
  }

  if (deletionGuard.shouldSkip) {
    if (tokenPersisted) {
      logger.info(`Preserving ${serviceName} OAuth token root for deleting user ${userID} because a token was already persisted for account-deletion deauthorization.`);
      return;
    }
    const existingTokenSnapshot = await tokenRootRef.collection('tokens').limit(1).get();
    if (!existingTokenSnapshot.empty) {
      logger.info(`Preserving ${serviceName} OAuth token root unchanged for deleting user ${userID} because existing tokens remain for account-deletion deauthorization.`);
      return;
    }
    await db.recursiveDelete(tokenRootRef);
    logger.info(`Deleted ${serviceName} OAuth token root for deleting user ${userID} while cleaning temporary OAuth data.`);
    return;
  }

  await tokenRootRef.update({
    state: admin.firestore.FieldValue.delete(),
    codeVerifier: admin.firestore.FieldValue.delete(),
  });
}

function buildUnpersistedServiceToken(response: AccessToken, serviceName: ServiceNames): Auth2ServiceTokenInterface {
  const currentDate = Date.now();
  const expiresIn = typeof response.token.expires_in === 'number'
    ? response.token.expires_in * 1000
    : 0;

  return {
    serviceName,
    accessToken: response.token.access_token as string,
    refreshToken: response.token.refresh_token as string,
    tokenType: (response.token.token_type as string) || 'bearer',
    expiresAt: currentDate + expiresIn,
    scope: response.token.scope as string,
    dateCreated: currentDate,
    dateRefreshed: currentDate,
  } as Auth2ServiceTokenInterface;
}

async function deauthorizeUnpersistedOAuthToken(
  adapter: ReturnType<typeof getServiceAdapter>,
  userID: string,
  serviceName: ServiceNames,
  response: AccessToken,
): Promise<void> {
  if (!response?.token?.access_token) {
    return;
  }

  const serviceToken = buildUnpersistedServiceToken(response, serviceName);
  const tokenArchiveId = `unpersisted-oauth-${crypto
    .createHash('sha256')
    .update(serviceToken.accessToken)
    .digest('hex')
    .slice(0, 16)}`;

  try {
    await adapter.deauthorize(serviceToken);
    logger.info(`Deauthorized unpersisted ${serviceName} OAuth token for deleting user ${userID}`);
  } catch (error) {
    logger.error(`Failed to deauthorize unpersisted ${serviceName} OAuth token for user ${userID}`, error);
    await archiveOrphanedServiceToken(
      userID,
      serviceName,
      tokenArchiveId,
      serviceToken as unknown as Record<string, unknown>,
      error,
    );
  }
}


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
      await cleanupServiceTokenById(otherUserId, serviceName, doc.id, SERVICE_AUTH_CLEANUP_REASONS.DuplicateConnectionCleanup);
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

  await assertOAuthUserCanWriteServiceState(userID, serviceName, `oauth_state_prepare:${serviceName}`);
  await setOAuthStateIfUserActive(userID, serviceName, adapter.tokenCollectionName, tokenData);

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
  let tokenPersisted = false;

  // Retrieve stored flow context (state, PKCE verifier, etc)
  const tokensDocumentSnapshot = await admin.firestore().collection(adapter.tokenCollectionName).doc(userID).get();
  const tokensDocumentSnapshotData = tokensDocumentSnapshot.data ? tokensDocumentSnapshot.data() : undefined;

  try {
    const tokenConfig = adapter.getTokenRequestConfig(redirectUri, code, tokensDocumentSnapshotData);

    await assertOAuthUserCanWriteServiceState(userID, serviceName, `oauth_token_exchange:${serviceName}`);

    const oauth2Client = adapter.getOAuth2Client();
    const results: AccessToken = await oauth2Client.getToken(tokenConfig);

    if (!results || !results.token || !results.token.access_token) {
      logger.error(`Failed to get token results for ${serviceName}`, { results });
      throw new Error(`No results when geting token for userID: ${userID}, serviceName: ${serviceName}`);
    }

    let uniqueId: string | undefined;
    try {
      await assertOAuthUserCanWriteServiceState(userID, serviceName, `oauth_token_process:${serviceName}`);

      // Use adapter to process post-token logic (fetch uniqueId, permissions, etc)
      const processedTokenData = await adapter.processNewToken(results, userID);
      uniqueId = processedTokenData.uniqueId;

      const tokenData = adapter.convertTokenResponse(results, uniqueId, processedTokenData);

      await setOAuthTokenIfUserActive(
        userID,
        serviceName,
        adapter.tokenCollectionName,
        uniqueId || 'default',
        tokenData,
      );
      tokenPersisted = true;
    } catch (error) {
      if (!tokenPersisted) {
        await deauthorizeUnpersistedOAuthToken(adapter, userID, serviceName, results);
      }
      throw error;
    }

    await clearServiceDisconnectPending(userID, serviceName);
    const didMarkConnected = await markServiceConnected(userID, serviceName);
    if (!didMarkConnected) {
      logger.warn(`Skipping duplicate cleanup for ${serviceName} OAuth callback for user ${userID} because the user is missing or deletion is in progress after token persistence.`);
      throw new OAuthServiceConnectionSkippedForDeletedUserError(userID, serviceName, `oauth_mark_connected:${serviceName}`);
    }

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
      await cleanupOAuthFlowContext(userID, serviceName, adapter.tokenCollectionName, tokenPersisted);
      logger.info(`Finished temporary OAuth2 cleanup for User ${userID} and ${serviceName}`);
    } catch (e) {
      // Don't fail if cleanup fails, but log it
      logger.warn(`Failed to cleanup temporary OAuth2 data for user ${userID}`, e);
    }
  }
}

interface DeauthorizeServiceForUserOptions {
  missingTokensBehavior?: MissingTokensBehavior;
}

export async function deauthorizeServiceForUser(
  userID: string,
  serviceName: ServiceNames,
  options: DeauthorizeServiceForUserOptions = {},
) {
  return cleanupServiceConnectionForUser(
    userID,
    serviceName,
    SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect,
    {
      missingTokensBehavior: options.missingTokensBehavior || 'throw',
      tokenResolver: (doc) => getTokenData(doc, serviceName, false, {
        recoverTerminalAuthFailure: false,
      }),
    },
  );
}

export async function deauthorizeServiceForSubscriptionEnforcement(
  userID: string,
  serviceName: ServiceNames,
) {
  return cleanupServiceConnectionForUser(
    userID,
    serviceName,
    SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
    {
      missingTokensBehavior: 'ignore',
      tokenResolver: (doc) => getTokenData(doc, serviceName, false, {
        recoverTerminalAuthFailure: false,
      }),
    },
  );
}

export async function disconnectServiceForUser(
  userID: string,
  serviceName: ServiceNames,
) {
  return deauthorizeServiceForUser(userID, serviceName, {
    missingTokensBehavior: 'ignore',
  });
}
