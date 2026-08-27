import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
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
  isTerminalRefreshFailureForService,
  TerminalServiceAuthError,
  TerminalServiceAuthFailureResolution,
} from './service-auth-lifecycle';
import { getUserDeletionGuardState } from './shared/user-deletion-guard';
import { getServiceDisconnectPendingData } from './service-disconnect-pending';
import { isServiceDisconnectPendingData } from './service-disconnect-pending-state';
import { doesServiceDisconnectOperationPermitTokenUse } from './service-token-store';
import { getWahooErrorLogDetails } from './wahoo/error-details';
import {
  COROS_ACCESS_TOKEN_EXPIRY_BUFFER_MS,
  COROS_ACCESS_TOKEN_VALIDITY_MS,
} from './coros/constants';
import {
  claimTokenRefresh,
  getTokenCredentialSnapshot,
  persistTokenRefresh,
  releaseTokenRefreshClaim,
  areTokenCredentialSnapshotsEqual,
  doesOAuthCredentialGenerationAuthorizeToken,
  TOKEN_REFRESH_REQUEST_TIMEOUT_MS,
} from './token-refresh-coordinator';
import {
  assertWahooConnectionAvailable,
  assertWahooRefreshAllowed,
  isOpaqueWahooRefreshFailure,
  toWahooRefreshFailureError,
} from './wahoo/refresh-recovery';
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
    public readonly reason: 'service_disconnect' | 'inactive_oauth_credential' = 'service_disconnect',
  ) {
    super(`Skipping ${serviceName} token use for ${tokenDocumentID} because service disconnect is pending for user ${firebaseUserID}.`);
  }
}

/** Another worker owns the current credential refresh; queue work must retry later. */
export class TokenRefreshInProgressError extends Error {
  public readonly name = 'TokenRefreshInProgressError';
  public readonly code = 'unavailable';
  public readonly statusCode = 503;

  constructor(
    public readonly serviceName: ServiceNames,
    public readonly tokenDocumentID: string,
  ) {
    super(`${serviceName} token refresh is already in progress for ${tokenDocumentID}.`);
  }
}

/** A reconnect, disconnect, or winning refresh replaced this worker's snapshot. */
export class TokenRefreshSupersededError extends Error {
  public readonly name = 'TokenRefreshSupersededError';
  public readonly code = 'unavailable';
  public readonly statusCode = 503;

  constructor(
    public readonly serviceName: ServiceNames,
    public readonly tokenDocumentID: string,
  ) {
    super(`${serviceName} token changed while refresh was in progress for ${tokenDocumentID}.`);
  }
}

class COROSTokenRefreshRejectedError extends Error {
  readonly name = 'COROSTokenRefreshRejectedError';
  readonly statusCode?: number;
  readonly data: { error: string; error_description: string };

  constructor(providerCode: string) {
    super('COROS token refresh was rejected.');
    if (providerCode === '5006') this.statusCode = 401;
    this.data = {
      error: providerCode || 'invalid_response',
      error_description: 'COROS token refresh was rejected.',
    };
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
  /** Omits token/account identifiers and provider response detail from auth telemetry. */
  opaqueTelemetry?: boolean;
  /** Fail closed unless the token still belongs to the root's active OAuth credential. */
  requireActiveOAuthCredentialGeneration?: boolean;
  /** Only the explicit-disconnect owner may use a token while its fence is active. */
  expectedDisconnectOperationGeneration?: string;
}

function getFirebaseUserIDForTokenDocument(doc: QueryDocumentSnapshot | DocumentSnapshot): string | null {
  return doc.ref.parent.parent?.id || null;
}

function shouldRequireActiveOAuthCredentialGeneration(
  serviceName: ServiceNames,
  options: Pick<
    GetTokenDataOptions,
    'expectedDisconnectOperationGeneration' | 'requireActiveOAuthCredentialGeneration'
  >,
): boolean {
  // The exact explicit-disconnect owner must still be able to deauthorize and
  // delete a historical orphan. All ordinary COROS workers and explicitly
  // fenced provider operations fail closed.
  return !options.expectedDisconnectOperationGeneration
    && (serviceName === ServiceNames.COROSAPI
      || options.requireActiveOAuthCredentialGeneration === true);
}

async function assertTokenUseAllowedForUser(
  doc: QueryDocumentSnapshot | DocumentSnapshot,
  serviceName: ServiceNames,
  phase: 'before_return' | 'before_refresh' | 'before_persist',
  options: Pick<
    GetTokenDataOptions,
    | 'allowDisconnectPendingTokenUse'
    | 'expectedDisconnectOperationGeneration'
    | 'opaqueTelemetry'
    | 'requireActiveOAuthCredentialGeneration'
  > = {},
): Promise<void> {
  const firebaseUserID = getFirebaseUserIDForTokenDocument(doc);
  if (!firebaseUserID) {
    if (options.opaqueTelemetry) {
      logger.warn('[ServiceAuth] Provider token has no Firebase user root.', { serviceName, phase });
    } else {
      logger.warn(`Skipping deletion guard for ${serviceName} token ${doc.id} during ${phase}; token document has no Firebase user root.`);
    }
    return;
  }

  const deletionGuard = await getUserDeletionGuardState(admin.firestore(), firebaseUserID);
  if (deletionGuard.shouldSkip) {
    if (options.opaqueTelemetry) {
      logger.warn('[ServiceAuth] Skipping provider token use because account deletion is in progress.', {
        serviceName,
        phase,
      });
    } else {
      logger.warn(
        `Skipping ${serviceName} token refresh for ${doc.id} during ${phase} because user ${firebaseUserID} is missing or deletion is in progress.`,
      );
    }
    throw new TokenRefreshSkippedForDeletedUserError(firebaseUserID, serviceName, doc.id, phase);
  }

  const tokenRootData = await getServiceDisconnectPendingData(firebaseUserID, serviceName);
  if (shouldRequireActiveOAuthCredentialGeneration(serviceName, options)
    && !doesOAuthCredentialGenerationAuthorizeToken(
      tokenRootData as Record<string, unknown> | null,
      (doc.data() as Record<string, unknown> | undefined)?.tokenCredentialGeneration,
    )) {
    logger.warn(
      `Skipping ${serviceName} token use during ${phase} because its active OAuth credential root is missing or changed.`,
    );
    throw new TokenUseSkippedForPendingDisconnectError(
      firebaseUserID,
      serviceName,
      doc.id,
      phase,
      'inactive_oauth_credential',
    );
  }
  if (!doesServiceDisconnectOperationPermitTokenUse(
    tokenRootData,
    options.expectedDisconnectOperationGeneration,
  )) {
    if (options.opaqueTelemetry) {
      logger.warn('[ServiceAuth] Skipping provider token use because another disconnect lifecycle owns it.', {
        serviceName,
        phase,
      });
    } else {
      logger.warn(
        `Skipping ${serviceName} token use for ${doc.id} during ${phase} because another disconnect lifecycle owns user ${firebaseUserID}.`,
      );
    }
    throw new TokenUseSkippedForPendingDisconnectError(firebaseUserID, serviceName, doc.id, phase);
  }

  if (options.allowDisconnectPendingTokenUse !== true && isServiceDisconnectPendingData(tokenRootData)) {
    if (options.opaqueTelemetry) {
      logger.warn('[ServiceAuth] Skipping provider token use because service disconnect is pending.', {
        serviceName,
        phase,
      });
    } else {
      logger.warn(
        `Skipping ${serviceName} token use for ${doc.id} during ${phase} because service disconnect is pending for user ${firebaseUserID}.`,
      );
    }
    throw new TokenUseSkippedForPendingDisconnectError(firebaseUserID, serviceName, doc.id, phase);
  }

  if (serviceName === ServiceNames.WahooAPI) {
    await assertWahooConnectionAvailable(firebaseUserID);
  }
}

async function retryWithLatestTokenSnapshot(
  latestSnapshot: DocumentSnapshot | null,
  serviceName: ServiceNames,
  originalTokenDocumentID: string,
  options: GetTokenDataOptions,
): Promise<SuuntoAPIAuth2ServiceTokenInterface | COROSAPIAuth2ServiceTokenInterface | GarminAPIAuth2ServiceTokenInterface | WahooAPIAuth2ServiceTokenInterface> {
  if (!latestSnapshot?.exists || options.allowSupersededSnapshotRetry === false) {
    throw new TokenRefreshSupersededError(serviceName, originalTokenDocumentID);
  }

  return getTokenData(latestSnapshot, serviceName, false, {
    ...options,
    allowSupersededSnapshotRetry: false,
  });
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
    throw new Error(options.opaqueTelemetry
      ? `Missing ${serviceName} token data.`
      : `Missing ${serviceName} token data for ${doc.id}`);
  }
  // doc.data() is never undefined for query doc snapshots
  const token = serviceConfig.getOAuth2Client(true).createToken({
    'access_token': serviceTokenData.accessToken,
    'refresh_token': serviceTokenData.refreshToken,
    'expires_at': new Date(serviceTokenData.expiresAt), // We need to convert to date here for the lib to be able to check .expired()
  });

  if (!token.expired() && !forceRefreshAndSave) {
    await assertTokenUseAllowedForUser(doc, serviceName, 'before_return', options);
    if (options.opaqueTelemetry) {
      logger.info('[ServiceAuth] Provider token remains valid.', { serviceName });
    } else {
      logger.info(`Token is not expired won't refresh ${doc.id}`);
    }
    switch (serviceName) {
      default:
        throw new Error('Not Implemented');
      case ServiceNames.COROSAPI:
        return <COROSAPIAuth2ServiceTokenInterface><unknown>{
          serviceName: serviceName,
          accessToken: serviceTokenData.accessToken,
          refreshToken: serviceTokenData.refreshToken,
          expiresAt: serviceTokenData.expiresAt,
          scope: serviceTokenData.scope,
          tokenType: serviceTokenData.tokenType,
          openId: serviceTokenData.openId,
          dateRefreshed: serviceTokenData.dateRefreshed,
          dateCreated: serviceTokenData.dateCreated,
          // Internal callers use this server-owned value to fence work across
          // same-account OAuth replacement. Keep it on every token projection,
          // including the ordinary non-refresh path.
          tokenCredentialGeneration: typeof (serviceTokenData as unknown as Record<string, unknown>)
            .tokenCredentialGeneration === 'string'
            ? (serviceTokenData as unknown as Record<string, string>).tokenCredentialGeneration
            : undefined,
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
    if (options.opaqueTelemetry) {
      logger.info('[ServiceAuth] Provider token has expired.', { serviceName });
    } else {
      logger.info(`Token ${doc.id} has expired`);
    }
  }

  await assertTokenUseAllowedForUser(doc, serviceName, 'before_refresh', options);
  const firebaseUserID = getFirebaseUserIDForTokenDocument(doc);
  if (serviceName === ServiceNames.WahooAPI && firebaseUserID) {
    await assertWahooRefreshAllowed(firebaseUserID);
  }

  const initialCredential = getTokenCredentialSnapshot(serviceTokenData as unknown as Record<string, unknown>);
  const requireActiveOAuthCredentialGeneration = shouldRequireActiveOAuthCredentialGeneration(serviceName, options);
  const claimResult = await claimTokenRefresh(doc.ref, initialCredential, {
    expectedDisconnectOperationGeneration: options.expectedDisconnectOperationGeneration,
    ...(requireActiveOAuthCredentialGeneration
      ? { requireActiveOAuthCredentialGeneration: true }
      : {}),
  });
  if (claimResult.kind === 'skipped_user_deletion') {
    const userID = getFirebaseUserIDForTokenDocument(doc);
    if (userID) {
      throw new TokenRefreshSkippedForDeletedUserError(userID, serviceName, doc.id, 'before_refresh');
    }
    throw new TokenRefreshSupersededError(serviceName, doc.id);
  }
  if (claimResult.kind === 'skipped_service_disconnect') {
    const userID = getFirebaseUserIDForTokenDocument(doc);
    if (userID) {
      throw new TokenUseSkippedForPendingDisconnectError(userID, serviceName, doc.id, 'before_refresh');
    }
    throw new TokenRefreshSupersededError(serviceName, doc.id);
  }
  if (claimResult.kind === 'superseded') {
    return retryWithLatestTokenSnapshot(
      claimResult.snapshot as DocumentSnapshot | null,
      serviceName,
      doc.id,
      options,
    );
  }
  if (claimResult.kind === 'busy') {
    const latestSnapshot = await doc.ref.get();
    const latestData = latestSnapshot.data() as Record<string, unknown> | undefined;
    if (
      latestSnapshot.exists
      && !areTokenCredentialSnapshotsEqual(getTokenCredentialSnapshot(latestData), initialCredential)
    ) {
      return retryWithLatestTokenSnapshot(latestSnapshot, serviceName, doc.id, options);
    }
    throw new TokenRefreshInProgressError(serviceName, doc.id);
  }

  // Claiming itself advances Firestore's update time. Re-read the claimed
  // document so terminal-auth cleanup compares against the lease-owning
  // snapshot, not the pre-claim snapshot and so it can still detect a later
  // OAuth replacement.
  const refreshDoc = await doc.ref.get();
  const refreshTokenData = refreshDoc.data() as Auth2ServiceTokenInterface | undefined;
  if (
    !refreshDoc.exists
    || !refreshTokenData
    || (refreshTokenData as unknown as Record<string, unknown>).tokenRefreshLeaseOwner !== claimResult.leaseOwner
    || !areTokenCredentialSnapshotsEqual(
      getTokenCredentialSnapshot(refreshTokenData as unknown as Record<string, unknown>),
      claimResult.credential,
    )
  ) {
    await releaseTokenRefreshClaim(doc.ref, claimResult.leaseOwner, claimResult.credential, {
      ...(requireActiveOAuthCredentialGeneration
        ? { requireActiveOAuthCredentialGeneration: true }
        : {}),
    });
    return retryWithLatestTokenSnapshot(refreshDoc.exists ? refreshDoc : null, serviceName, doc.id, options);
  }
  const refreshToken = serviceConfig.getOAuth2Client(true).createToken({
    'access_token': refreshTokenData.accessToken,
    'refresh_token': refreshTokenData.refreshToken,
    'expires_at': new Date(refreshTokenData.expiresAt),
  });

  let releaseClaim = true;
  try {
    await assertTokenUseAllowedForUser(refreshDoc, serviceName, 'before_refresh', options);
    const wahooRefreshLifecycleGuard = serviceName === ServiceNames.WahooAPI && firebaseUserID
      ? await assertWahooRefreshAllowed(firebaseUserID)
      : null;

    let responseToken: any;
    try {
      responseToken = await refreshToken.refresh({}, {
        timeout: TOKEN_REFRESH_REQUEST_TIMEOUT_MS,
      });
      if (serviceName === ServiceNames.COROSAPI) {
        const resultCode = `${responseToken.token.result ?? ''}`.trim();
        const message = `${responseToken.token.message ?? ''}`.trim();
        if (!/^0+$/.test(resultCode) || message !== 'OK') {
          throw new COROSTokenRefreshRejectedError(resultCode);
        }
      }
      if (options.opaqueTelemetry) {
        logger.info('[ServiceAuth] Successfully refreshed provider token.', { serviceName });
      } else {
        logger.info(`Successfully refreshed token ${refreshDoc.id}`);
      }
    } catch (e: any) {
      const failure = extractRefreshFailureDetails(e);
      const recoverTerminalAuthFailure = options.recoverTerminalAuthFailure !== false;
      const isTerminalAuthFailure = isTerminalRefreshFailureForService(serviceName, failure);
      const isProviderDowngradedAuthFailure = failure.isTerminalAuthFailure && !isTerminalAuthFailure;

      if (options.opaqueTelemetry) {
        logger.warn('[ServiceAuth] Provider token refresh failed during an opaque operation.', {
          serviceName,
          phase: 'token_refresh',
          providerStatus: failure.statusCode || undefined,
          terminal: isTerminalAuthFailure,
          outcome: isTerminalAuthFailure ? 'reconnect_required' : 'retry',
        });
      } else if (isProviderDowngradedAuthFailure) {
        logger.warn('[ServiceAuth] Provider token refresh rejected with a known non-terminal error.', {
          serviceName,
          phase: 'token_refresh',
          providerStatus: failure.statusCode || undefined,
          providerErrorCode: failure.isInvalidGrant ? 'invalid_grant' : undefined,
          terminal: false,
          outcome: 'retry',
        });
      } else if (failure.isTransientError && serviceName === ServiceNames.WahooAPI) {
        logger.warn(`Token refresh for user ${refreshDoc.id} failed`, getWahooErrorLogDetails(e));
      } else if (failure.isTransientError) {
        // Do not log the full stack trace for these known errors during cleanup
        logger.warn(`Token refresh for user ${refreshDoc.id} failed (${failure.statusCode || 'unknown'}): ${failure.logMessage}`);
      } else if (serviceName === ServiceNames.WahooAPI) {
        logger.error(`Could not refresh token for user ${refreshDoc.id}`, getWahooErrorLogDetails(e));
      } else {
        logger.error(`Could not refresh token for user ${refreshDoc.id}`, e);
      }

      if (serviceName === ServiceNames.WahooAPI && firebaseUserID && isOpaqueWahooRefreshFailure(failure)) {
        throw await toWahooRefreshFailureError(firebaseUserID, {
          tokenRef: doc.ref,
          leaseOwner: claimResult.leaseOwner,
          credential: claimResult.credential,
          connectionStateGeneration: wahooRefreshLifecycleGuard?.connectionStateGeneration || null,
        });
      }

      if (isTerminalAuthFailure) {
        if (recoverTerminalAuthFailure) {
          const terminalOriginalError = serviceName === ServiceNames.WahooAPI
            ? new Error('Wahoo token refresh failed.')
            : e;
          const resolution: TerminalServiceAuthFailureResolution = options.opaqueTelemetry
            ? await handleTerminalServiceAuthFailure(
              refreshDoc,
              serviceName,
              refreshTokenData,
              failure,
              terminalOriginalError,
              { opaqueTelemetry: true },
            )
            : await handleTerminalServiceAuthFailure(
              refreshDoc,
              serviceName,
              refreshTokenData,
              failure,
              terminalOriginalError,
            );
          if (resolution.kind === 'retry_with_latest_snapshot') {
            if (options.opaqueTelemetry) {
              logger.info('[ServiceAuth] Retrying provider token with a newer stored snapshot.', { serviceName });
            } else {
              logger.info(`Retrying ${serviceName} token ${refreshDoc.id} with a newer stored snapshot after terminal auth failure.`);
            }
            return retryWithLatestTokenSnapshot(resolution.latestSnapshot, serviceName, doc.id, options);
          }
          throw resolution.error;
        }
        throw new TerminalServiceAuthError(
          serviceName,
          getFirebaseUserIDForTokenDocument(refreshDoc),
          refreshDoc.id,
          failure.statusCode,
          failure.providerErrorCode,
          failure.providerErrorMessage,
          serviceName === ServiceNames.WahooAPI ? new Error('Wahoo token refresh failed.') : e,
        );
      }
      throw e;
    }

    let newToken;
    const date = new Date();
    const refreshCompletedAtMs = Date.now();
    switch (serviceName) {
      default:
        throw new Error('Not implemented');
      case ServiceNames.SuuntoApp:
        newToken = <SuuntoAPIAuth2ServiceTokenInterface>{
          serviceName,
          accessToken: responseToken.token.access_token,
          refreshToken: responseToken.token.refresh_token || refreshTokenData.refreshToken,
          expiresAt: (responseToken.token as any).expires_at.getTime() - 600000,
          scope: responseToken.token.scope,
          tokenType: responseToken.token.token_type,
          userName: (responseToken.token as any).user,
          dateRefreshed: date.getTime(),
          dateCreated: refreshTokenData.dateCreated,
        };
        break;
      case ServiceNames.GarminAPI:
        newToken = <GarminAPIAuth2ServiceTokenInterface>{
          serviceName,
          accessToken: responseToken.token.access_token,
          refreshToken: responseToken.token.refresh_token || refreshTokenData.refreshToken,
          expiresAt: (responseToken.token as any).expires_at.getTime() - 600000,
          scope: responseToken.token.scope,
          tokenType: responseToken.token.token_type,
          userID: (refreshTokenData as any).userID,
          permissions: (refreshTokenData as any).permissions,
          dateRefreshed: date.getTime(),
          dateCreated: refreshTokenData.dateCreated,
        };
        break;
      case ServiceNames.COROSAPI:
        newToken = <COROSAPIAuth2ServiceTokenInterface>{
          ...refreshTokenData,
          serviceName,
          accessToken: refreshTokenData.accessToken,
          refreshToken: refreshTokenData.refreshToken,
          expiresAt: refreshCompletedAtMs
            + COROS_ACCESS_TOKEN_VALIDITY_MS
            - COROS_ACCESS_TOKEN_EXPIRY_BUFFER_MS,
          dateRefreshed: refreshCompletedAtMs,
        };
        break;
      case ServiceNames.WahooAPI:
        newToken = <WahooAPIAuth2ServiceTokenInterface>{
          serviceName,
          accessToken: `${responseToken.token.access_token || ''}`,
          refreshToken: `${responseToken.token.refresh_token || refreshTokenData.refreshToken}`,
          expiresAt: (responseToken.token as any).expires_at.getTime(),
          scope: `${responseToken.token.scope || refreshTokenData.scope}`,
          tokenType: `${responseToken.token.token_type || refreshTokenData.tokenType || 'bearer'}`,
          wahooUserID: (refreshTokenData as WahooAPIAuth2ServiceTokenInterface).wahooUserID,
          dateRefreshed: date.getTime(),
          dateCreated: refreshTokenData.dateCreated,
        };
        break;
    }

    await assertTokenUseAllowedForUser(refreshDoc, serviceName, 'before_persist', options);
    const persistResult = await persistTokenRefresh(
      doc.ref,
      claimResult.leaseOwner,
      claimResult.credential,
      newToken as unknown as Record<string, unknown>,
      {
        ...(serviceName === ServiceNames.WahooAPI && firebaseUserID ? {
          companionWrites: [{
            ref: admin.firestore()
              .collection('users')
              .doc(firebaseUserID)
              .collection('meta')
              .doc(ServiceNames.WahooAPI),
            data: {
              wahooRefreshFailureCount: FieldValue.delete(),
              wahooRefreshFailureLastAt: FieldValue.delete(),
              wahooRefreshRetryAt: FieldValue.delete(),
              lastAuthFailureCode: FieldValue.delete(),
              lastAuthFailureMessage: FieldValue.delete(),
            },
          }],
        } : {}),
        expectedDisconnectOperationGeneration: options.expectedDisconnectOperationGeneration,
        ...(requireActiveOAuthCredentialGeneration
          ? { requireActiveOAuthCredentialGeneration: true }
          : {}),
      },
    );
    if (persistResult.kind === 'persisted') {
      releaseClaim = false;
      if (options.opaqueTelemetry) {
        logger.info('[ServiceAuth] Successfully saved refreshed provider token.', { serviceName });
      } else {
        logger.info(`Successfully saved refreshed token ${refreshDoc.id}`);
      }
      return newToken;
    }
    if (persistResult.kind === 'skipped_user_deletion') {
      const userID = getFirebaseUserIDForTokenDocument(refreshDoc);
      if (userID) {
        throw new TokenRefreshSkippedForDeletedUserError(userID, serviceName, refreshDoc.id, 'before_persist');
      }
      throw new TokenRefreshSupersededError(serviceName, doc.id);
    }
    return retryWithLatestTokenSnapshot(
      persistResult.snapshot as DocumentSnapshot | null,
      serviceName,
      doc.id,
      options,
    );
  } finally {
    if (releaseClaim) {
      try {
        await releaseTokenRefreshClaim(doc.ref, claimResult.leaseOwner, claimResult.credential, {
          ...(requireActiveOAuthCredentialGeneration
            ? { requireActiveOAuthCredentialGeneration: true }
            : {}),
        });
      } catch (releaseError) {
        logger.warn(
          options.opaqueTelemetry
            ? '[ServiceAuth] Could not release provider token refresh lease.'
            : `Could not release ${serviceName} token refresh lease for ${doc.id}.`,
          {
            serviceName,
            errorName: releaseError instanceof Error ? releaseError.name : 'UnknownError',
          },
        );
      }
    }
  }
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
