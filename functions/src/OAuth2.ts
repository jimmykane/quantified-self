import { ServiceNames } from '@sports-alliance/sports-lib';
import { AccessToken } from 'simple-oauth2';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
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
  buildStoredServiceToken,
  MissingTokensBehavior,
  SERVICE_AUTH_CLEANUP_REASONS,
} from './service-auth-lifecycle';
import {
  clearServiceDisconnectPending,
  getServiceDisconnectLifecycleGuardFromRootData,
  resumeServiceDisconnectRetryAfterRecoveryFailure,
  type ServiceDisconnectLifecycleGuard,
} from './service-disconnect-pending';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from './shared/user-deletion-guard';
import { archiveOrphanedServiceToken } from './orphaned-service-tokens';
import { hasProAccess } from './utils';
import {
  EXPLICIT_DISCONNECT_OPERATION_LEASE_MS,
  OAUTH_FLOW_CREATED_AT_FIELD,
  OAUTH_FLOW_EXPIRES_AT_FIELD,
  OAUTH_FLOW_GENERATION_FIELD,
  OAUTH_FLOW_TTL_MS,
  SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD,
  SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD,
  getActiveServiceDisconnectOperationGeneration,
  getServiceTokenRootDocumentRef,
} from './service-token-store';
import {
  ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
  type DocumentGenerationGuard,
} from './token-refresh-coordinator';
import { assertWahooOAuthAccountCompatible } from './wahoo/account';
import {
  buildSuuntoHealthWebhookAccountBinding,
  doesSuuntoHealthWebhookBindingMatch,
  getSuuntoHealthWebhookAccountBindingRef,
  parseSuuntoHealthWebhookAccountBinding,
  SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES,
} from './suunto/health-webhook-binding';
import {
  SERVICE_OAUTH_COMPLETION_OUTCOMES,
  SERVICE_DISCONNECT_RETRY_BLOCKERS,
  SERVICE_DISCONNECT_RETRY_REASON,
  type ServiceOAuthCompletionResult,
  type ServiceDisconnectRetryBlocker,
  type ServiceDisconnectRetryDetails,
} from '../../shared/service-connection';
export { deleteLocalServiceToken } from './service-token-store';

interface PersistedOAuthCredentialGuard {
  rootGenerationGuard: DocumentGenerationGuard;
  oauthFlowGenerationGuard: DocumentGenerationGuard;
  tokenRef: admin.firestore.DocumentReference;
  tokenCredentialGeneration: string;
}

export { OAUTH_FLOW_GENERATION_FIELD } from './service-token-store';

interface ClaimedOAuthFlowContext {
  data: Record<string, unknown>;
  generation: string;
}

interface ExplicitDisconnectOperation {
  lifecycleGuard: ServiceDisconnectLifecycleGuard;
  tokenQuerySnapshot: admin.firestore.QuerySnapshot;
  startedAtMs: number;
  leaseExpiresAtMs: number;
}

type ExplicitDisconnectFinishStatus = 'cleared' | 'root_missing' | 'stale';

function getDisconnectOperationCorrelationId(
  disconnectOperationGeneration: string | null | undefined,
): string {
  const generation = `${disconnectOperationGeneration || ''}`.trim();
  return generation
    ? crypto.createHash('sha256').update(generation).digest('hex').slice(0, 16)
    : 'missing';
}

function getDisconnectErrorTelemetry(error: unknown): {
  errorName: string;
  errorCode?: string | number;
} {
  const rawErrorName = error instanceof Error ? error.name : typeof error;
  const errorName = /^[a-z0-9_.:-]{1,64}$/i.test(rawErrorName)
    ? rawErrorName
    : 'UnknownError';
  if (!error || typeof error !== 'object') return { errorName };
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number' && Number.isFinite(code)) {
    return { errorName, errorCode: code };
  }
  if (typeof code === 'string' && /^[a-z0-9_.:-]{1,64}$/i.test(code)) {
    return { errorName, errorCode: code };
  }
  return { errorName };
}

function logDisconnectLifecycle(
  level: 'error' | 'info' | 'warn',
  fields: Record<string, unknown>,
): void {
  try {
    logger[level]('[OAuthDisconnect] Lifecycle transition.', fields);
  } catch {
    // Observability must never change OAuth or credential-cleanup behavior.
  }
}

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

export class OAuthFlowContextMismatchError extends Error {
  public readonly name = 'OAuthFlowContextMismatchError';
  public readonly statusCode = 403;

  constructor(serviceName: ServiceNames) {
    super(`The ${serviceName} OAuth callback does not match the active authorization flow.`);
  }
}

export function isOAuthFlowContextMismatchError(error: unknown): error is OAuthFlowContextMismatchError {
  return error instanceof OAuthFlowContextMismatchError
    || (error instanceof Error && error.name === 'OAuthFlowContextMismatchError');
}

const SERVICE_DISCONNECT_RETRY_POLL_MS = 2_000;

export class ServiceDisconnectInProgressError extends Error {
  public readonly name = 'ServiceDisconnectInProgressError';
  public readonly code = 'unavailable';
  public readonly statusCode = 503;
  public readonly details: ServiceDisconnectRetryDetails;

  constructor(
    serviceName: ServiceNames,
    blocker: ServiceDisconnectRetryBlocker,
    blockingLeaseExpiresAt: number,
    nowMs = Date.now(),
  ) {
    super(blocker === SERVICE_DISCONNECT_RETRY_BLOCKERS.TokenRefresh
      ? `${serviceName} credentials are being refreshed. Disconnect will retry shortly.`
      : `${serviceName} is already being disconnected. Please retry shortly.`);
    const normalizedLeaseExpiry = Number.isFinite(blockingLeaseExpiresAt)
      ? Math.max(nowMs, blockingLeaseExpiresAt)
      : nowMs + SERVICE_DISCONNECT_RETRY_POLL_MS;
    this.details = {
      reason: SERVICE_DISCONNECT_RETRY_REASON,
      blocker,
      retryAt: Math.min(normalizedLeaseExpiry, nowMs + SERVICE_DISCONNECT_RETRY_POLL_MS),
      retryDeadlineAt: normalizedLeaseExpiry,
    };
  }
}

export function isServiceDisconnectInProgressError(error: unknown): error is ServiceDisconnectInProgressError {
  if (!(error instanceof Error) || error.name !== 'ServiceDisconnectInProgressError') return false;
  const details = (error as Partial<ServiceDisconnectInProgressError>).details;
  return details?.reason === SERVICE_DISCONNECT_RETRY_REASON
    && Object.values(SERVICE_DISCONNECT_RETRY_BLOCKERS).includes(details.blocker)
    && Number.isFinite(details.retryAt)
    && Number.isFinite(details.retryDeadlineAt);
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

async function beginOAuthFlowIfUserActive(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
  state: string,
): Promise<string> {
  const db = admin.firestore();
  const tokenRootRef = db.collection(tokenCollectionName).doc(userID);
  const generation = crypto.randomUUID();
  await db.runTransaction(async transaction => {
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
    const rootSnapshot = await transaction.get(tokenRootRef);
    const rootData = rootSnapshot.data() as Record<string, unknown> | undefined;
    const nowMs = Date.now();
    if (getActiveServiceDisconnectOperationGeneration(rootData, nowMs)) {
      throw new ServiceDisconnectInProgressError(
        serviceName,
        SERVICE_DISCONNECT_RETRY_BLOCKERS.DisconnectOperation,
        Number(rootData?.[SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD] || 0),
        nowMs,
      );
    }

    // This is the first durable action in an OAuth-start request. Disconnects
    // and newer starts rotate this generation, so any delayed preparation can
    // only publish state for the lifecycle episode it actually claimed.
    transaction.set(tokenRootRef, {
      state,
      codeVerifier: FieldValue.delete(),
      [OAUTH_FLOW_GENERATION_FIELD]: generation,
      [OAUTH_FLOW_CREATED_AT_FIELD]: nowMs,
      [OAUTH_FLOW_EXPIRES_AT_FIELD]: nowMs + OAUTH_FLOW_TTL_MS,
      // A legacy child can outlive a root that was deleted before recursive
      // cleanup completed. Recreating that COROS root must not make a
      // generation-less orphan active while the user is still in OAuth.
      ...(serviceName === ServiceNames.COROSAPI && !rootSnapshot.exists
        ? { [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: generation }
        : {}),
      // A prior process may have died after claiming an explicit disconnect.
      // Starting a new OAuth episode is the safe recovery point for an
      // expired fence and invalidates that old owner.
      [SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]: FieldValue.delete(),
      [SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD]: FieldValue.delete(),
    }, { merge: true });
  });
  return generation;
}

async function completeOAuthFlowPreparationIfCurrent(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
  generation: string,
  context: Record<string, unknown> | null | undefined,
): Promise<void> {
  const db = admin.firestore();
  const tokenRootRef = db.collection(tokenCollectionName).doc(userID);
  await db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `oauth_state_finalize:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) {
      throw new OAuthServiceConnectionSkippedForDeletedUserError(userID, serviceName, `oauth_state_finalize:${serviceName}`);
    }

    const snapshot = await transaction.get(tokenRootRef);
    if (
      !snapshot.exists
      || snapshot.data()?.[OAUTH_FLOW_GENERATION_FIELD] !== generation
      || getActiveServiceDisconnectOperationGeneration(
        snapshot.data() as Record<string, unknown> | undefined,
      )
    ) {
      throw new OAuthFlowContextMismatchError(serviceName);
    }
    transaction.set(tokenRootRef, {
      ...(context && Object.keys(context).length > 0 ? context : {}),
      // If a disconnect lease elapsed between OAuth start and this write, the
      // winning OAuth flow fences the old cleanup before publishing context.
      [SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]: FieldValue.delete(),
      [SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD]: FieldValue.delete(),
    }, { merge: true });
  });
}

async function abandonOAuthFlowPreparationIfCurrent(
  userID: string,
  tokenCollectionName: string,
  generation: string,
): Promise<void> {
  await finishRejectedOAuthFlowIfCurrent(userID, tokenCollectionName, generation);
}

async function finishRejectedOAuthFlowIfCurrent(
  userID: string,
  tokenCollectionName: string,
  generation: string,
): Promise<void> {
  const tokenRootRef = admin.firestore().collection(tokenCollectionName).doc(userID);
  await admin.firestore().runTransaction(async transaction => {
    const rootSnapshot = await transaction.get(tokenRootRef);
    const rootData = rootSnapshot.data() as Record<string, unknown> | undefined;
    if (!rootSnapshot.exists || rootData?.[OAUTH_FLOW_GENERATION_FIELD] !== generation) return;

    const cleanupUpdate: Record<string, FieldValue> = {
      state: FieldValue.delete(),
      codeVerifier: FieldValue.delete(),
      [OAUTH_FLOW_GENERATION_FIELD]: FieldValue.delete(),
      [OAUTH_FLOW_CREATED_AT_FIELD]: FieldValue.delete(),
      [OAUTH_FLOW_EXPIRES_AT_FIELD]: FieldValue.delete(),
    };
    // Retain the root even when this clears its final field. A legacy
    // maintenance writer can create a token child without reading the root;
    // deleting the parent document could therefore orphan that child. Keep
    // the active credential generation as a fail-closed sentinel too: a
    // delayed generation-less child must not become authorized after this
    // rejected flow removes its transient context.
    transaction.set(tokenRootRef, cleanupUpdate, { merge: true });
  });
}

/**
 * Claims and consumes the exact callback context in one transaction. OAuth
 * state and PKCE verifiers are single-use: an older callback must never read
 * or delete context installed by a newer authorization attempt.
 */
async function claimOAuthFlowContext(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
  expectedState: string,
): Promise<ClaimedOAuthFlowContext> {
  const db = admin.firestore();
  const tokenRootRef = db.collection(tokenCollectionName).doc(userID);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `oauth_context_claim:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) {
      throw new OAuthServiceConnectionSkippedForDeletedUserError(
        userID,
        serviceName,
        `oauth_context_claim:${serviceName}`,
      );
    }

    const snapshot = await transaction.get(tokenRootRef);
    const data = snapshot.data() as Record<string, unknown> | undefined;
    const generation = typeof data?.[OAUTH_FLOW_GENERATION_FIELD] === 'string'
      ? data[OAUTH_FLOW_GENERATION_FIELD].trim()
      : '';
    const expiresAt = data?.[OAUTH_FLOW_EXPIRES_AT_FIELD];
    if (
      !snapshot.exists
      || data?.state !== expectedState
      || !generation
      || typeof expiresAt !== 'number'
      || !Number.isFinite(expiresAt)
      || expiresAt <= Date.now()
    ) {
      throw new OAuthFlowContextMismatchError(serviceName);
    }

    transaction.update(tokenRootRef, {
      state: FieldValue.delete(),
      codeVerifier: FieldValue.delete(),
    });
    return { data, generation };
  });
}

async function beginExplicitDisconnectOperation(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
): Promise<ExplicitDisconnectOperation> {
  const db = admin.firestore();
  const tokenRootRef = db.collection(tokenCollectionName).doc(userID);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, userID);
    } catch (error) {
      throw new UserDeletionGuardReadError(userID, `oauth_disconnect_invalidate:${serviceName}`, error);
    }
    if (deletionGuard.shouldSkip) {
      throw new OAuthServiceConnectionSkippedForDeletedUserError(
        userID,
        serviceName,
        `oauth_disconnect_invalidate:${serviceName}`,
      );
    }

    const [rootSnapshot, tokenSnapshots] = await Promise.all([
      transaction.get(tokenRootRef),
      transaction.get(tokenRootRef.collection('tokens')),
    ]);
    // The first explicit disconnect owns this root fence until its finally
    // block completes. A second request must not replace that generation: the
    // first may already be deauthorizing the provider credential.
    const rootData = rootSnapshot.exists
      ? rootSnapshot.data() as Record<string, unknown>
      : undefined;
    const nowMs = Date.now();
    if (getActiveServiceDisconnectOperationGeneration(rootData, nowMs)) {
      throw new ServiceDisconnectInProgressError(
        serviceName,
        SERVICE_DISCONNECT_RETRY_BLOCKERS.DisconnectOperation,
        Number(rootData?.[SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD] || 0),
        nowMs,
      );
    }
    const refreshBlockingLeaseExpiresAt = tokenSnapshots.docs.reduce((latestExpiry, snapshot) => {
      const tokenData = typeof snapshot.data === 'function' ? snapshot.data() : undefined;
      const leaseOwner = `${tokenData?.tokenRefreshLeaseOwner || ''}`.trim();
      const leaseExpiresAt = Number(tokenData?.tokenRefreshLeaseExpiresAt || 0);
      return leaseOwner && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > nowMs
        ? Math.max(latestExpiry, leaseExpiresAt)
        : latestExpiry;
    }, 0);
    if (refreshBlockingLeaseExpiresAt > nowMs) {
      throw new ServiceDisconnectInProgressError(
        serviceName,
        SERVICE_DISCONNECT_RETRY_BLOCKERS.TokenRefresh,
        refreshBlockingLeaseExpiresAt,
        nowMs,
      );
    }
    const invalidatedOAuthFlowGeneration = crypto.randomUUID();
    const disconnectOperationGeneration = crypto.randomUUID();
    const nextRootData = {
      ...(rootSnapshot.exists ? rootSnapshot.data() as Record<string, unknown> : {}),
      [OAUTH_FLOW_GENERATION_FIELD]: invalidatedOAuthFlowGeneration,
      [OAUTH_FLOW_CREATED_AT_FIELD]: FieldValue.delete(),
      [OAUTH_FLOW_EXPIRES_AT_FIELD]: FieldValue.delete(),
      [SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]: disconnectOperationGeneration,
      [SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD]: nowMs + EXPLICIT_DISCONNECT_OPERATION_LEASE_MS,
      state: FieldValue.delete(),
      codeVerifier: FieldValue.delete(),
    };
    transaction.set(tokenRootRef, nextRootData, { merge: true });
    return {
      lifecycleGuard: getServiceDisconnectLifecycleGuardFromRootData({
        ...nextRootData,
        state: undefined,
        codeVerifier: undefined,
      }),
      tokenQuerySnapshot: tokenSnapshots,
      startedAtMs: nowMs,
      leaseExpiresAtMs: nowMs + EXPLICIT_DISCONNECT_OPERATION_LEASE_MS,
    };
  });
}

async function finishExplicitDisconnectOperation(
  userID: string,
  serviceName: ServiceNames,
  guard: ServiceDisconnectLifecycleGuard,
): Promise<ExplicitDisconnectFinishStatus> {
  const rootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  return admin.firestore().runTransaction(async transaction => {
    const snapshot = await transaction.get(rootRef);
    if (!snapshot.exists) return 'root_missing';
    const current = getServiceDisconnectLifecycleGuardFromRootData(
      snapshot.data() as Record<string, unknown>,
    );
    if (
      current.oauthFlowGeneration !== guard.oauthFlowGeneration
      || current.disconnectOperationGeneration !== guard.disconnectOperationGeneration
    ) return 'stale';
    transaction.set(rootRef, {
      [OAUTH_FLOW_GENERATION_FIELD]: FieldValue.delete(),
      [OAUTH_FLOW_CREATED_AT_FIELD]: FieldValue.delete(),
      [OAUTH_FLOW_EXPIRES_AT_FIELD]: FieldValue.delete(),
      [SERVICE_DISCONNECT_OPERATION_GENERATION_FIELD]: FieldValue.delete(),
      [SERVICE_DISCONNECT_OPERATION_LEASE_EXPIRES_AT_FIELD]: FieldValue.delete(),
    }, { merge: true });
    return 'cleared';
  });
}

async function setOAuthTokenIfUserActive(
  userID: string,
  serviceName: ServiceNames,
  tokenCollectionName: string,
  tokenID: string,
  tokenData: Record<string, unknown>,
  expectedOAuthFlowGeneration: string,
): Promise<PersistedOAuthCredentialGuard> {
  const db = admin.firestore();
  const tokenRootRef = db.collection(tokenCollectionName).doc(userID);
  const tokenDocRef = tokenRootRef.collection('tokens').doc(tokenID);
  const persistedTokenData = {
    ...tokenData,
    tokenCredentialGeneration: crypto.randomUUID(),
  };
  const suuntoProviderUserId = serviceName === ServiceNames.SuuntoApp
    && typeof tokenData.userName === 'string'
    && tokenData.userName.trim().length > 0
    ? tokenData.userName.trim()
    : null;
  const suuntoBindingRef = suuntoProviderUserId
    ? getSuuntoHealthWebhookAccountBindingRef(db, suuntoProviderUserId, userID)
    : null;
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
    const tokenRootSnapshot = await transaction.get(tokenRootRef);
    if (
      !tokenRootSnapshot.exists
      || tokenRootSnapshot.data()?.[OAUTH_FLOW_GENERATION_FIELD] !== expectedOAuthFlowGeneration
    ) {
      throw new OAuthFlowContextMismatchError(serviceName);
    }
    // A reauthorization replaces the credential generation atomically with
    // the provider token. A refresh worker that started from an older
    // snapshot can therefore never persist over the newly authorized token.
    transaction.set(tokenRootRef, {
      [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: persistedTokenData.tokenCredentialGeneration,
    }, { merge: true });
    transaction.set(tokenDocRef, persistedTokenData);
    if (suuntoBindingRef && suuntoProviderUserId) {
      transaction.set(
        suuntoBindingRef,
        buildSuuntoHealthWebhookAccountBinding(
          userID,
          suuntoProviderUserId,
          persistedTokenData.tokenCredentialGeneration,
          SUUNTO_WEBHOOK_BINDING_AUTHORIZATION_SOURCES.OAuthCallback,
        ),
      );
    }
  });
  return {
    rootGenerationGuard: {
      documentRef: tokenRootRef,
      fieldName: ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD,
      expectedGeneration: persistedTokenData.tokenCredentialGeneration,
    },
    oauthFlowGenerationGuard: {
      documentRef: tokenRootRef,
      fieldName: OAUTH_FLOW_GENERATION_FIELD,
      expectedGeneration: expectedOAuthFlowGeneration,
    },
    tokenRef: tokenDocRef,
    tokenCredentialGeneration: persistedTokenData.tokenCredentialGeneration,
  };
}

/**
 * Removes only the credential written by a callback that lost to a newer OAuth
 * generation. If the same provider account reused the token document, the
 * winning callback's generation makes this a no-op.
 */
async function deleteSupersededOAuthCredentialIfCurrent(
  userID: string,
  serviceName: ServiceNames,
  guard: PersistedOAuthCredentialGuard,
): Promise<boolean> {
  const db = admin.firestore();
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        userID,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(
        userID,
        `oauth_superseded_credential_cleanup:${serviceName}`,
        error,
      );
    }
    if (deletionGuard.shouldSkip) {
      // Account deletion owns provider deauthorization and recursive cleanup.
      return false;
    }

    const suuntoBindingRef = serviceName === ServiceNames.SuuntoApp
      && typeof guard.tokenRef.id === 'string'
      && guard.tokenRef.id.trim().length > 0
      ? getSuuntoHealthWebhookAccountBindingRef(db, guard.tokenRef.id.trim(), userID)
      : null;
    const [tokenRootSnapshot, tokenSnapshot, suuntoBindingSnapshot] = await Promise.all([
      transaction.get(guard.rootGenerationGuard.documentRef),
      transaction.get(guard.tokenRef),
      suuntoBindingRef ? transaction.get(suuntoBindingRef) : Promise.resolve(null),
    ]);
    if (
      getActiveServiceDisconnectOperationGeneration(
        tokenRootSnapshot.data() as Record<string, unknown> | undefined,
      )
      || !tokenSnapshot.exists
      || tokenSnapshot.data()?.tokenCredentialGeneration !== guard.tokenCredentialGeneration
    ) {
      return false;
    }

    transaction.delete(guard.tokenRef);
    if (suuntoBindingRef
      && suuntoBindingSnapshot
      && doesSuuntoHealthWebhookBindingMatch(
        parseSuuntoHealthWebhookAccountBinding(suuntoBindingSnapshot.data()),
        userID,
        guard.tokenRef.id.trim(),
        guard.tokenCredentialGeneration,
      )) {
      // Suunto webhook bindings are permanent leaf documents: clients cannot
      // create descendants and no Admin writer defines a child collection.
      // The document-only delete remains atomic with the OAuth lifecycle fence.
      transaction.delete(suuntoBindingRef);
    }
    return true;
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
  // Suunto explicitly supports the same provider account being connected to
  // more than one Firebase user. Each owner has an independent credential and
  // webhook binding, so cross-user cleanup would silently break fan-out.
  if (serviceName === ServiceNames.SuuntoApp) return;

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
  await assertOAuthUserCanWriteServiceState(userID, serviceName, `oauth_state_prepare:${serviceName}`);
  const generation = await beginOAuthFlowIfUserActive(
    userID,
    serviceName,
    adapter.tokenCollectionName,
    state,
  );

  try {
    const { options, context } = await adapter.getAuthorizationData(redirectUri, state);
    await completeOAuthFlowPreparationIfCurrent(
      userID,
      serviceName,
      adapter.tokenCollectionName,
      generation,
      context,
    );
    return adapter.getOAuth2Client().authorizeURL(options);
  } catch (error) {
    await abandonOAuthFlowPreparationIfCurrent(userID, adapter.tokenCollectionName, generation);
    throw error;
  }
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
 * @param callbackState
 */
export async function getAndSetServiceOAuth2AccessTokenForUser(
  userID: string,
  serviceName: ServiceNames,
  redirectUri: string,
  code: string,
  callbackState: string,
): Promise<ServiceOAuthCompletionResult> {
  const adapter = getServiceAdapter(serviceName);
  let tokenPersisted = false;
  let persistedOAuthCredentialGuard: PersistedOAuthCredentialGuard | null = null;

  // Atomically validate and consume state plus PKCE context before the
  // provider exchange. A second callback or an older callback loses here.
  const claimedOAuthFlowContext = await claimOAuthFlowContext(
    userID,
    serviceName,
    adapter.tokenCollectionName,
    callbackState,
  );

  const tokenConfig = adapter.getTokenRequestConfig(
    redirectUri,
    code,
    claimedOAuthFlowContext.data,
  );

  await assertOAuthUserCanWriteServiceState(userID, serviceName, `oauth_token_exchange:${serviceName}`);

  const oauth2Client = adapter.getOAuth2Client();
  const results: AccessToken = await oauth2Client.getToken(tokenConfig);

  if (!results || !results.token || !results.token.access_token) {
    logger.error(`Failed to get a usable access token for ${serviceName}`);
    throw new Error(`No results when geting token for userID: ${userID}, serviceName: ${serviceName}`);
  }

  let uniqueId: string | undefined;
  try {
    await assertOAuthUserCanWriteServiceState(userID, serviceName, `oauth_token_process:${serviceName}`);

    // Use adapter to process post-token logic (fetch uniqueId, permissions, etc)
    const processedTokenData = await adapter.processNewToken(results, userID);
    uniqueId = processedTokenData.uniqueId;

    if (serviceName === ServiceNames.WahooAPI) {
      await assertWahooOAuthAccountCompatible(userID, `${uniqueId || ''}`);
    }

    const tokenData = adapter.convertTokenResponse(results, uniqueId, processedTokenData);

    persistedOAuthCredentialGuard = await setOAuthTokenIfUserActive(
      userID,
      serviceName,
      adapter.tokenCollectionName,
      uniqueId || 'default',
      tokenData,
      claimedOAuthFlowContext.generation,
    );
    tokenPersisted = true;
  } catch (error) {
    if (!tokenPersisted) {
      await deauthorizeUnpersistedOAuthToken(adapter, userID, serviceName, results);
    }
    throw error;
  }

  if (await hasProAccess(userID)) {
    if (!persistedOAuthCredentialGuard) {
      throw new Error(`Missing persisted ${serviceName} credential guard after OAuth token write.`);
    }
    const pendingDisconnectClearResult = await clearServiceDisconnectPending(
      userID,
      serviceName,
      persistedOAuthCredentialGuard.rootGenerationGuard,
      persistedOAuthCredentialGuard.oauthFlowGenerationGuard,
    );
    if (
      pendingDisconnectClearResult !== 'cleared'
      && pendingDisconnectClearResult !== 'no_pending'
    ) {
      logger.warn(`Skipping stale ${serviceName} OAuth callback for user ${userID} because pending disconnect state was not cleared.`, {
        pendingDisconnectClearResult,
      });
      const deletedSupersededCredential = await deleteSupersededOAuthCredentialIfCurrent(
        userID,
        serviceName,
        persistedOAuthCredentialGuard,
      );
      if (deletedSupersededCredential) {
        await deauthorizeUnpersistedOAuthToken(adapter, userID, serviceName, results);
      }
      throw new OAuthServiceConnectionSkippedForDeletedUserError(
        userID,
        serviceName,
        `oauth_clear_disconnect_pending:${serviceName}`,
      );
    }
    const didMarkConnected = (serviceName === ServiceNames.WahooAPI
      || serviceName === ServiceNames.COROSAPI
      || serviceName === ServiceNames.GarminAPI) && uniqueId
      ? await markServiceConnected(
        userID,
        serviceName,
        uniqueId,
        persistedOAuthCredentialGuard.rootGenerationGuard,
        persistedOAuthCredentialGuard.oauthFlowGenerationGuard,
      )
      : await markServiceConnected(
        userID,
        serviceName,
        undefined,
        persistedOAuthCredentialGuard.rootGenerationGuard,
        persistedOAuthCredentialGuard.oauthFlowGenerationGuard,
      );
    if (!didMarkConnected) {
      logger.warn(`Skipping stale ${serviceName} OAuth callback for user ${userID} because a newer credential or account lifecycle transition won after token persistence.`);
      const deletedSupersededCredential = await deleteSupersededOAuthCredentialIfCurrent(
        userID,
        serviceName,
        persistedOAuthCredentialGuard,
      );
      if (deletedSupersededCredential) {
        await deauthorizeUnpersistedOAuthToken(adapter, userID, serviceName, results);
      }
      throw new OAuthServiceConnectionSkippedForDeletedUserError(userID, serviceName, `oauth_mark_connected:${serviceName}`);
    }
  } else {
    const outcome = await deauthorizeServiceForSubscriptionEnforcement(userID, serviceName, {
      allowDisconnectPendingTokenUse: true,
    });
    logger.warn(`Immediately deauthorized ${serviceName} OAuth recovery token for non-Pro user ${userID}.`, {
      deletedTokenCount: outcome.deletedTokenCount,
      preservedTokenCount: outcome.preservedTokenCount,
      localCleanupStatus: outcome.localCleanupStatus,
      retryableDisconnectFailureCount: outcome.retryableDisconnectFailures?.length || 0,
    });
    const retryableFailure = outcome.retryableDisconnectFailures?.[0];
    if (retryableFailure) {
      const didResumeRetry = await resumeServiceDisconnectRetryAfterRecoveryFailure(userID, serviceName, retryableFailure);
      if (!didResumeRetry) {
        logger.warn(`Skipped pending ${serviceName} disconnect retry resume for non-Pro OAuth recovery because the user is missing or deletion is in progress.`, {
          userID,
          serviceName,
          tokenID: retryableFailure.tokenID,
          statusCode: retryableFailure.statusCode,
        });
      }
    }
    await finishRejectedOAuthFlowIfCurrent(
      userID,
      adapter.tokenCollectionName,
      claimedOAuthFlowContext.generation,
    );
    const disconnectRecoveryCompleted = outcome.preservedTokenCount === 0
      && outcome.skippedByCondition !== true
      && !outcome.retryableDisconnectFailures?.length
      && outcome.connectionStateUpdate === 'cleared'
      && (outcome.localCleanupStatus === 'completed'
        || outcome.localCleanupStatus === 'no_tokens_found');
    return {
      connected: false,
      outcome: disconnectRecoveryCompleted
        ? SERVICE_OAUTH_COMPLETION_OUTCOMES.DisconnectRecoveryCompleted
        : SERVICE_OAUTH_COMPLETION_OUTCOMES.DisconnectRecoveryPending,
    };
  }

  // Providers with single-owner semantics remove OTHER users connected to the
  // same external account. Suunto preserves independent shared connections.
  if (uniqueId && serviceName !== ServiceNames.SuuntoApp) {
    try {
      await removeDuplicateConnections(userID, serviceName, uniqueId);
    } catch (e) {
      logger.error(`Failed to cleanup duplicate connections for ${userID}`, e);
      // Don't fail the auth flow for this, just log
    }
  }

  logger.info(`User ${userID} successfully connected to ${serviceName}`);
  return {
    connected: true,
    outcome: SERVICE_OAUTH_COMPLETION_OUTCOMES.Connected,
  };
}

interface DeauthorizeServiceForUserOptions {
  missingTokensBehavior?: MissingTokensBehavior;
}

interface DeauthorizeServiceForSubscriptionEnforcementOptions {
  allowDisconnectPendingTokenUse?: boolean;
}

export async function deauthorizeServiceForUser(
  userID: string,
  serviceName: ServiceNames,
  options: DeauthorizeServiceForUserOptions = {},
) {
  const adapter = getServiceAdapter(serviceName);
  // This transaction orders explicit disconnect against both a claimed
  // callback and a newer authorization attempt. Whichever wins first leaves a
  // generation the callback must still prove before recreating credentials.
  const disconnectOperation = await beginExplicitDisconnectOperation(
    userID,
    serviceName,
    adapter.tokenCollectionName,
  );
  const disconnectLifecycleGuard = disconnectOperation.lifecycleGuard;
  const operationCorrelationId = getDisconnectOperationCorrelationId(
    disconnectLifecycleGuard.disconnectOperationGeneration,
  );
  logDisconnectLifecycle('info', {
    lifecycleEvent: 'disconnect_operation_claimed',
    serviceName,
    operationCorrelationId,
    tokenCount: disconnectOperation.tokenQuerySnapshot.size,
    leaseExpiresAtMs: disconnectOperation.leaseExpiresAtMs,
  });
  const cleanupResult = await (async () => {
    try {
      const outcome = await cleanupServiceConnectionForUser(
        userID,
        serviceName,
        SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect,
        {
          missingTokensBehavior: options.missingTokensBehavior || 'throw',
          disconnectLifecycleGuard,
          initialTokenQuerySnapshot: disconnectOperation.tokenQuerySnapshot,
          tokenResolver: (doc) => getTokenData(doc, serviceName, false, {
            recoverTerminalAuthFailure: false,
            expectedDisconnectOperationGeneration:
              disconnectLifecycleGuard.disconnectOperationGeneration || undefined,
          }),
        },
      );
      logDisconnectLifecycle('info', {
        lifecycleEvent: 'disconnect_cleanup_completed',
        serviceName,
        operationCorrelationId,
        durationMs: Date.now() - disconnectOperation.startedAtMs,
        tokenCount: outcome.tokenCount,
        deletedTokenCount: outcome.deletedTokenCount,
        preservedTokenCount: outcome.preservedTokenCount,
        partnerDeauthorizeAttempted: outcome.partnerDeauthorizeAttempted,
        partnerDeauthorizeFailed: outcome.partnerDeauthorizeFailed,
        localCleanupStatus: outcome.localCleanupStatus,
        connectionStateUpdate: outcome.connectionStateUpdate,
        skippedByCondition: outcome.skippedByCondition === true,
      });
      return { ok: true as const, outcome };
    } catch (error) {
      logDisconnectLifecycle('error', {
        lifecycleEvent: 'disconnect_cleanup_failed',
        serviceName,
        operationCorrelationId,
        durationMs: Date.now() - disconnectOperation.startedAtMs,
        ...getDisconnectErrorTelemetry(error),
      });
      return { ok: false as const, error };
    }
  })();

  logDisconnectLifecycle('info', {
    lifecycleEvent: 'disconnect_finalization_started',
    serviceName,
    operationCorrelationId,
    durationMs: Date.now() - disconnectOperation.startedAtMs,
  });
  try {
    const finalizationStatus = await finishExplicitDisconnectOperation(
      userID,
      serviceName,
      disconnectLifecycleGuard,
    );
    logDisconnectLifecycle('info', {
      lifecycleEvent: 'disconnect_finalization_completed',
      serviceName,
      operationCorrelationId,
      durationMs: Date.now() - disconnectOperation.startedAtMs,
      finalizationStatus,
    });
  } catch (error) {
    logDisconnectLifecycle('error', {
      lifecycleEvent: 'disconnect_finalization_failed',
      serviceName,
      operationCorrelationId,
      durationMs: Date.now() - disconnectOperation.startedAtMs,
      ...getDisconnectErrorTelemetry(error),
    });
    throw error;
  }

  if (!cleanupResult.ok) throw cleanupResult.error;
  return cleanupResult.outcome;
}

export async function deauthorizeServiceForSubscriptionEnforcement(
  userID: string,
  serviceName: ServiceNames,
  options: DeauthorizeServiceForSubscriptionEnforcementOptions = {},
) {
  return cleanupServiceConnectionForUser(
    userID,
    serviceName,
    SERVICE_AUTH_CLEANUP_REASONS.SubscriptionEnforcement,
    {
      missingTokensBehavior: 'ignore',
      tokenResolver: async (doc) => {
        try {
          return await getTokenData(doc, serviceName, false, {
            recoverTerminalAuthFailure: false,
            allowDisconnectPendingTokenUse: options.allowDisconnectPendingTokenUse === true,
          });
        } catch (error) {
          // An inactive same-user COROS child is intentionally unavailable to
          // every normal worker, but subscription enforcement must still try
          // to revoke it. The cleanup coordinator revalidates both its token
          // snapshot and captured root lifecycle before the provider call and
          // conditional local delete, so this fallback cannot target a newer
          // reconnect credential.
          if (serviceName === ServiceNames.COROSAPI
            && error instanceof Error
            && (error as Error & { reason?: unknown }).reason === 'inactive_oauth_credential') {
            return buildStoredServiceToken(
              serviceName,
              doc.data() as Auth2ServiceTokenInterface,
            );
          }
          throw error;
        }
      },
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
