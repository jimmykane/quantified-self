import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
  COROSAPIAuth2ServiceTokenInterface,
  SuuntoAPIAuth2ServiceTokenInterface,
  Auth2ServiceTokenInterface,
  WahooAPIAuth2ServiceTokenInterface,
} from '@sports-alliance/sports-lib';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getServiceAdapter } from './auth/factory';
import { GarminAPIAuth2ServiceTokenInterface } from './garmin/auth/adapter';
import {
  extractRefreshFailureDetails,
  handleTerminalServiceAuthFailure,
  TerminalServiceAuthError,
  TerminalServiceAuthFailureResolution,
  type RefreshFailureDetails,
} from './service-auth-lifecycle';
import { getUserDeletionGuardState } from './shared/user-deletion-guard';
import { isServiceDisconnectPendingForUser } from './service-disconnect-pending';
import { getWahooErrorLogDetails } from './wahoo/error-details';
import QueryDocumentSnapshot = admin.firestore.QueryDocumentSnapshot;
import DocumentSnapshot = admin.firestore.DocumentSnapshot;
import QuerySnapshot = admin.firestore.QuerySnapshot;

export { TerminalServiceAuthError } from './service-auth-lifecycle';

export class TokenRefreshSkippedForDeletedUserError extends Error {
  public readonly name = 'TokenRefreshSkippedForDeletedUserError';

  constructor(
    public readonly firebaseUserID: string,
    public readonly serviceName: ServiceNames,
    public readonly tokenDocumentID: string,
    public readonly phase: 'before_return' | 'before_refresh' | 'before_persist',
  ) {
    super(`Skipping ${serviceName} token use for ${tokenDocumentID} because user ${firebaseUserID} is missing or deletion is in progress.`);
  }
}

export class TokenUseSkippedForPendingDisconnectError extends Error {
  public readonly name = 'TokenUseSkippedForPendingDisconnectError';

  constructor(
    public readonly firebaseUserID: string,
    public readonly serviceName: ServiceNames,
    public readonly tokenDocumentID: string,
    public readonly phase: 'before_return' | 'before_refresh' | 'before_persist',
  ) {
    super(`Skipping ${serviceName} token use for ${tokenDocumentID} because service disconnect is pending for user ${firebaseUserID}.`);
  }
}

//
export async function refreshTokens(querySnapshot: QuerySnapshot, serviceName: ServiceNames) {
  logger.info(`Found ${querySnapshot.size} auth tokens to process`);
  let count = 0;
  for (const authToken of querySnapshot.docs) {
    try {
      await getTokenData(authToken, serviceName, true);
      count++;
    } catch (e) {
      if (e instanceof TokenUseSkippedForPendingDisconnectError
        || (e instanceof Error && e.name === 'TokenUseSkippedForPendingDisconnectError')) {
        logger.warn(`Skipping stale ${serviceName} token refresh for ${authToken.id} because service disconnect is pending.`);
        continue;
      }
      logger.error(`Error parsing token #${count} of ${querySnapshot.size} and id ${authToken.id}`, e);
    }
  }
  logger.info(`Parsed ${count} auth tokens out of ${querySnapshot.size}`);
}

interface GetTokenDataOptions {
  recoverTerminalAuthFailure?: boolean;
  allowSupersededSnapshotRetry?: boolean;
  allowDisconnectPendingTokenUse?: boolean;
}

function getFirebaseUserIDForTokenDocument(doc: QueryDocumentSnapshot | DocumentSnapshot): string | null {
  return doc.ref.parent.parent?.id || null;
}

function shouldTreatRefreshFailureAsTerminal(
  serviceName: ServiceNames,
  failure: RefreshFailureDetails,
): boolean {
  // Temporary Suunto policy: during the July 2026 outage Suunto returned false
  // 400 invalid_grant responses, then accepted the same refresh token later.
  // TODO: Revert this provider-specific downgrade once Suunto patches this.
  if (serviceName === ServiceNames.SuuntoApp && failure.isInvalidGrant && failure.statusCode !== 401) {
    return false;
  }

  return failure.isTerminalAuthFailure;
}

async function assertTokenUseAllowedForUser(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  serviceName: ServiceNames,
  phase: 'before_return' | 'before_refresh' | 'before_persist',
  options: Pick<GetTokenDataOptions, 'allowDisconnectPendingTokenUse'> = {},
): Promise<void> {
  const firebaseUserID = getFirebaseUserIDForTokenDocument(doc);
  if (!firebaseUserID) {
    logger.warn(`Skipping deletion guard for ${serviceName} token ${doc.id} during ${phase}; token document has no Firebase user root.`);
    return;
  }

  const deletionGuard = await getUserDeletionGuardState(admin.firestore(), firebaseUserID);
  if (deletionGuard.shouldSkip) {
    logger.warn(
      `Skipping ${serviceName} token refresh for ${doc.id} during ${phase} because user ${firebaseUserID} is missing or deletion is in progress.`,
    );
    throw new TokenRefreshSkippedForDeletedUserError(firebaseUserID, serviceName, doc.id, phase);
  }

  if (options.allowDisconnectPendingTokenUse === true) {
    return;
  }

  if (await isServiceDisconnectPendingForUser(firebaseUserID, serviceName)) {
    logger.warn(
      `Skipping ${serviceName} token use for ${doc.id} during ${phase} because service disconnect is pending for user ${firebaseUserID}.`,
    );
    throw new TokenUseSkippedForPendingDisconnectError(firebaseUserID, serviceName, doc.id, phase);
  }
}

export async function getTokenData(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  serviceName: ServiceNames,
  forceRefreshAndSave = false,
  options: GetTokenDataOptions = {},
): Promise<SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface | GarminAPIAuth2ServiceTokenInterface | WahooAPIAuth2ServiceTokenInterface> {
  const serviceConfig = getServiceAdapter(serviceName, true);
  const serviceTokenData = <Auth2ServiceTokenInterface | undefined>doc.data();
  if (!serviceTokenData) {
    throw new Error(`Missing ${serviceName} token data for ${doc.id}`);
  }
  // doc.data() is never undefined for query doc snapshots
  const token = serviceConfig.getOAuth2Client(true).createToken({
    'access_token': serviceTokenData.accessToken,
    'refresh_token': serviceTokenData.refreshToken,
    'expires_at': new Date(serviceTokenData.expiresAt), // We need to convert to date here for the lib to be able to check .expired()
  });

  if (!token.expired() && !forceRefreshAndSave) {
    await assertTokenUseAllowedForUser(doc, serviceName, 'before_return', options);
    logger.info(`Token is not expired won't refresh ${doc.id}`);
    switch (serviceName) {
      default:
        throw new Error('Not Implemented');
      case ServiceNames.COROSAPI:
        return <COROSAPIAuth2ServiceTokenInterface>{
          serviceName: serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          openId: serviceTokenData.openId,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
        };
      case ServiceNames.SuuntoApp:
        return <SuuntoAPIAuth2ServiceTokenInterface>{
          serviceName: serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          userName: serviceTokenData.userName,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
        };
      case ServiceNames.GarminAPI:
        return <GarminAPIAuth2ServiceTokenInterface>{
          serviceName: serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          userID: (serviceTokenData as any).userID,
          permissions: (serviceTokenData as any).permissions, // Expose permissions
          permissionsLastChangedAt: (serviceTokenData as any).permissionsLastChangedAt,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
        };
      case ServiceNames.WahooAPI:
        return <WahooAPIAuth2ServiceTokenInterface>{
          serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          wahooUserID: (serviceTokenData as WahooAPIAuth2ServiceTokenInterface).wahooUserID,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
        };
    }
  }

  if (token.expired()) {
    logger.info(`Token ${doc.id} has expired`);
  }

  let responseToken;
  const date = new Date();
  await assertTokenUseAllowedForUser(doc, serviceName, 'before_refresh', options);
  try {
    responseToken = await token.refresh();
    // COROS Exception for response
    if (responseToken.token.message && responseToken.token.message !== 'OK') {
      throw new Error('Something went wrong');
    }
    logger.info(`Successfully refreshed token ${doc.id}`);
  } catch (e: any) {
    const failure = extractRefreshFailureDetails(e);
    const recoverTerminalAuthFailure = options.recoverTerminalAuthFailure !== false;
    const isTerminalAuthFailure = shouldTreatRefreshFailureAsTerminal(serviceName, failure);

    if (failure.isTransientError && serviceName === ServiceNames.WahooAPI) {
      logger.warn(`Token refresh for user ${doc.id} failed`, getWahooErrorLogDetails(e));
    } else if (failure.isTransientError) {
      // Do not log the full stack trace for these known errors during cleanup
      logger.warn(`Token refresh for user ${doc.id} failed (${failure.statusCode || 'unknown'}): ${failure.logMessage}`);
    } else if (serviceName === ServiceNames.WahooAPI) {
      logger.error(`Could not refresh token for user ${doc.id}`, getWahooErrorLogDetails(e));
    } else {
      logger.error(`Could not refresh token for user ${doc.id}`, e);
    }

    if (failure.isTerminalAuthFailure && !isTerminalAuthFailure) {
      logger.warn(`Treating ${serviceName} invalid_grant for token ${doc.id} as retryable while waiting for the provider fix; preserving local token.`);
    }

    if (isTerminalAuthFailure) {
      if (recoverTerminalAuthFailure) {
        const resolution: TerminalServiceAuthFailureResolution = await handleTerminalServiceAuthFailure(
          doc,
          serviceName,
          serviceTokenData,
          failure,
          serviceName === ServiceNames.WahooAPI ? new Error('Wahoo token refresh failed.') : e,
        );
        if (resolution.kind === 'retry_with_latest_snapshot' && options.allowSupersededSnapshotRetry !== false) {
          logger.info(`Retrying ${serviceName} token ${doc.id} with a newer stored snapshot after terminal auth failure.`);
          return getTokenData(resolution.latestSnapshot, serviceName, forceRefreshAndSave, {
            ...options,
            allowSupersededSnapshotRetry: false,
          });
        }
        if (resolution.kind === 'retry_with_latest_snapshot') {
          logger.warn(`Token ${doc.id} for ${serviceName} changed again while recovering from terminal auth failure. Retrying this work item later with the newest stored token.`);
          throw new Error(`${serviceName} token changed during terminal auth recovery`);
        }
        throw resolution.error;
      }
      throw new TerminalServiceAuthError(
        serviceName,
        getFirebaseUserIDForTokenDocument(doc),
        doc.id,
        failure.statusCode,
        failure.providerErrorCode,
        failure.providerErrorMessage,
        serviceName === ServiceNames.WahooAPI ? new Error('Wahoo token refresh failed.') : e,
      );
    }
    throw e;
  }

  let newToken;
  switch (serviceName) {
    default:
      throw new Error('Not implemented');
    case ServiceNames.SuuntoApp:
      newToken = <SuuntoAPIAuth2ServiceTokenInterface>{
        serviceName: serviceName,
        accessToken: responseToken.token.access_token,
        refreshToken: responseToken.token.refresh_token || serviceTokenData.refreshToken,
        expiresAt: (responseToken.token as any).expires_at.getTime() - 600000, // 600 seconds buffer per Garmin recommendation
        scope: responseToken.token.scope,
        tokenType: responseToken.token.token_type,
        userName: (responseToken.token as any).user,
        dateRefreshed: date.getTime(),
        dateCreated: serviceTokenData.dateCreated,
      };
      break;
    case ServiceNames.GarminAPI:
      newToken = <GarminAPIAuth2ServiceTokenInterface>{
        serviceName: serviceName,
        accessToken: responseToken.token.access_token,
        refreshToken: responseToken.token.refresh_token || serviceTokenData.refreshToken,
        expiresAt: (responseToken.token as any).expires_at.getTime() - 600000, // 600 seconds buffer per Garmin recommendation
        scope: responseToken.token.scope,
        tokenType: responseToken.token.token_type,
        userID: (serviceTokenData as any).userID, // Preserve User ID
        permissions: (serviceTokenData as any).permissions, // Preserve persist permissions
        dateRefreshed: date.getTime(),
        dateCreated: serviceTokenData.dateCreated,
      };
      break;
    case ServiceNames.COROSAPI:
      newToken = <COROSAPIAuth2ServiceTokenInterface>serviceTokenData;
      newToken.expiresAt = date.getTime() - 6000;
      newToken.dateRefreshed = date.getTime();
      break;
    case ServiceNames.WahooAPI:
      newToken = <WahooAPIAuth2ServiceTokenInterface>{
        serviceName,
        accessToken: `${responseToken.token.access_token || ''}`,
        refreshToken: `${responseToken.token.refresh_token || serviceTokenData.refreshToken}`,
        expiresAt: (responseToken.token as any).expires_at.getTime(),
        scope: `${responseToken.token.scope || serviceTokenData.scope}`,
        tokenType: `${responseToken.token.token_type || serviceTokenData.tokenType || 'bearer'}`,
        wahooUserID: (serviceTokenData as WahooAPIAuth2ServiceTokenInterface).wahooUserID,
        dateRefreshed: date.getTime(),
        dateCreated: serviceTokenData.dateCreated,
      };
      break;
  }

  await assertTokenUseAllowedForUser(doc, serviceName, 'before_persist', options);
  await doc.ref.update(newToken as any);
  logger.info(`Successfully saved refreshed token ${doc.id}`);
  return newToken;
}

/**
 * Refreshes tokens that are older than the stale threshold or have never been refreshed.
 *
 * @param {string} serviceName The name of the service (e.g., 'Suunto', 'COROS').
 * @param {number} staleThresholdDate The timestamp (ms) before which tokens are considered stale.
 */
export async function refreshStaleTokens(serviceName: string, staleThresholdDate: number): Promise<void> {
  const firestore = admin.firestore();

  // Query 1: Tokens older than the threshold
  const staleTokensQuery = firestore
    .collectionGroup('tokens')
    .where('serviceName', '==', serviceName)
    .where('dateRefreshed', '<=', staleThresholdDate)
    .limit(50)
    .get();

  // Query 2: Tokens with no refresh date (null)
  const missingDateRefreshedQuery = firestore
    .collectionGroup('tokens')
    .where('serviceName', '==', serviceName)
    .where('dateRefreshed', '==', null)
    .limit(50)
    .get();

  const [staleSnapshots, missingDateSnapshots] = await Promise.all([
    staleTokensQuery,
    missingDateRefreshedQuery,
  ]);

  await refreshTokens(staleSnapshots, serviceName as ServiceNames);
  await refreshTokens(missingDateSnapshots, serviceName as ServiceNames);
}
