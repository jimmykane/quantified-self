import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Auth2ServiceTokenInterface, ServiceNames } from '@sports-alliance/sports-lib';
import { GarminAPIAuth2ServiceTokenInterface } from './garmin/auth/adapter';
import { getServiceAdapter } from './auth/factory';
import { TokenNotFoundError } from './utils';
import {
  clearServiceConnectionState,
  markServiceReconnectRequired,
} from './service-connection-meta';
import {
  deleteLocalServiceToken,
  getServiceTokenCollectionRef,
  getServiceTokenRootDocumentRef,
} from './service-token-store';

type StoredServiceToken = Auth2ServiceTokenInterface | GarminAPIAuth2ServiceTokenInterface;
type QueryDocumentSnapshot = admin.firestore.QueryDocumentSnapshot;
type DocumentSnapshot = admin.firestore.DocumentSnapshot;

export const SERVICE_AUTH_CLEANUP_REASONS = {
  UserDisconnect: 'user_disconnect',
  TerminalAuthFailure: 'terminal_auth_failure',
  PartnerDisconnect: 'partner_disconnect',
  DuplicateConnectionCleanup: 'duplicate_connection_cleanup',
  OrphanCleanup: 'orphan_cleanup',
} as const;

export type ServiceAuthCleanupReason = typeof SERVICE_AUTH_CLEANUP_REASONS[keyof typeof SERVICE_AUTH_CLEANUP_REASONS];
export type MissingTokensBehavior = 'throw' | 'ignore';

export interface RefreshFailureDetails {
  statusCode: number | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  isInvalidGrant: boolean;
  isTerminalAuthFailure: boolean;
  isTransientError: boolean;
  logMessage: string;
}

export interface TerminalAuthFailureInput {
  providerUserId: string;
  statusCode: number | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
}

export interface ServiceAuthCleanupOutcome {
  reason: ServiceAuthCleanupReason;
  tokenCount: number;
  deletedTokenCount: number;
  preservedTokenCount: number;
  partnerDeauthorizeAttempted: number;
  partnerDeauthorizeFailed: number;
  localCleanupStatus: 'completed' | 'partial' | 'no_tokens_found';
  connectionStateUpdate: 'reconnect_required' | 'cleared' | 'unchanged';
  fallbackTokenRootCleanupPerformed: boolean;
}

export type TerminalServiceAuthFailureResolution =
  | {
    kind: 'terminal_error';
    error: TerminalServiceAuthError;
  }
  | {
    kind: 'retry_with_latest_snapshot';
    latestSnapshot: DocumentSnapshot;
  };

export class TerminalServiceAuthError extends Error {
  public readonly name = 'TerminalServiceAuthError';
  public readonly dlqContext: 'INVALID_GRANT' | 'AUTH_RECONNECT_REQUIRED';

  constructor(
    public readonly serviceName: ServiceNames,
    public readonly firebaseUserID: string | null,
    public readonly providerUserId: string,
    public readonly statusCode: number | null,
    public readonly providerErrorCode: string | null,
    public readonly providerErrorMessage: string | null,
    public readonly originalError: unknown,
    public readonly cleanupOutcome?: ServiceAuthCleanupOutcome,
  ) {
    const message = `${serviceName} connection requires reconnect${providerErrorMessage ? `: ${providerErrorMessage}` : ''}`;
    super(message);
    const invalidGrantHint = `${providerErrorCode || ''} ${providerErrorMessage || ''}`.toLowerCase();
    this.dlqContext = invalidGrantHint.includes('invalid_grant')
      ? 'INVALID_GRANT'
      : 'AUTH_RECONNECT_REQUIRED';
  }
}

export class ServiceTokenCleanupError extends Error {
  public readonly name = 'ServiceTokenCleanupError';

  constructor(
    public readonly userID: string,
    public readonly serviceName: ServiceNames,
    public readonly tokenID: string,
    public readonly cleanupOutcome: ServiceAuthCleanupOutcome,
    public readonly originalError: unknown,
  ) {
    super(`Failed to delete local ${serviceName} token ${tokenID} for user ${userID}`);
  }
}

interface ServiceAuthCleanupPolicy {
  attemptPartnerDeauthorize: boolean;
  clearConnectionStateWhenNoTokensRemain: boolean;
  preserveLocalTokenOnPartnerFailure: boolean;
  persistReconnectRequired: boolean;
  guaranteeLocalCleanup: boolean;
}

interface CleanupServiceConnectionOptions {
  missingTokensBehavior?: MissingTokensBehavior;
  tokenResolver?: (doc: QueryDocumentSnapshot) => Promise<StoredServiceToken>;
  terminalAuthFailure?: TerminalAuthFailureInput;
}

function normalizeErrorString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function extractRefreshFailureDetails(error: any): RefreshFailureDetails {
  const statusCode = error?.statusCode || error?.output?.statusCode || null;
  const providerErrorCode = normalizeErrorString(
    error?.data?.payload?.error
    || error?.data?.error
    || error?.error?.error,
  );
  const providerErrorMessage = normalizeErrorString(
    error?.data?.payload?.error_description
    || error?.data?.payload?.message
    || error?.data?.error_description
    || error?.error?.error_description
    || error?.message
    || providerErrorCode,
  );
  const errorFragments = [
    providerErrorCode,
    providerErrorMessage,
    normalizeErrorString(error?.message),
  ].filter((value): value is string => !!value)
    .map(value => value.toLowerCase());
  const isInvalidGrant = errorFragments.some(value => value.includes('invalid_grant'));
  const isTerminalAuthFailure = statusCode === 401 || isInvalidGrant;
  const isTransientError = statusCode === 400
    || statusCode === 401
    || statusCode === 500
    || statusCode === 502
    || (statusCode === 406 && errorFragments.some(value => value.includes('json compatible')));

  return {
    statusCode,
    providerErrorCode,
    providerErrorMessage,
    isInvalidGrant,
    isTerminalAuthFailure,
    isTransientError,
    logMessage: providerErrorMessage || providerErrorCode || 'Unknown token refresh failure',
  };
}

function buildStoredServiceToken(
  serviceName: ServiceNames,
  tokenData: Auth2ServiceTokenInterface,
): StoredServiceToken {
  switch (serviceName) {
    case ServiceNames.SuuntoApp:
      return {
        serviceName,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt,
        scope: tokenData.scope,
        tokenType: tokenData.tokenType,
        userName: (tokenData as any).userName,
        dateRefreshed: tokenData.dateRefreshed,
        dateCreated: tokenData.dateCreated,
      } as Auth2ServiceTokenInterface;
    case ServiceNames.COROSAPI:
      return {
        serviceName,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt,
        scope: tokenData.scope,
        tokenType: tokenData.tokenType,
        openId: (tokenData as any).openId,
        dateRefreshed: tokenData.dateRefreshed,
        dateCreated: tokenData.dateCreated,
      } as Auth2ServiceTokenInterface;
    case ServiceNames.GarminAPI:
      return {
        serviceName,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt,
        scope: tokenData.scope,
        tokenType: tokenData.tokenType,
        userID: (tokenData as any).userID,
        permissions: (tokenData as any).permissions,
        permissionsLastChangedAt: (tokenData as any).permissionsLastChangedAt,
        dateRefreshed: tokenData.dateRefreshed,
        dateCreated: tokenData.dateCreated,
      } as GarminAPIAuth2ServiceTokenInterface;
    default:
      throw new Error(`Unsupported service ${serviceName}`);
  }
}

function resolveCleanupPolicy(reason: ServiceAuthCleanupReason): ServiceAuthCleanupPolicy {
  switch (reason) {
    case SERVICE_AUTH_CLEANUP_REASONS.UserDisconnect:
      return {
        attemptPartnerDeauthorize: true,
        clearConnectionStateWhenNoTokensRemain: true,
        preserveLocalTokenOnPartnerFailure: true,
        persistReconnectRequired: false,
        guaranteeLocalCleanup: false,
      };
    case SERVICE_AUTH_CLEANUP_REASONS.TerminalAuthFailure:
      return {
        attemptPartnerDeauthorize: true,
        clearConnectionStateWhenNoTokensRemain: false,
        preserveLocalTokenOnPartnerFailure: false,
        persistReconnectRequired: true,
        guaranteeLocalCleanup: true,
      };
    case SERVICE_AUTH_CLEANUP_REASONS.PartnerDisconnect:
    case SERVICE_AUTH_CLEANUP_REASONS.DuplicateConnectionCleanup:
    case SERVICE_AUTH_CLEANUP_REASONS.OrphanCleanup:
      return {
        attemptPartnerDeauthorize: false,
        clearConnectionStateWhenNoTokensRemain: true,
        preserveLocalTokenOnPartnerFailure: false,
        persistReconnectRequired: false,
        guaranteeLocalCleanup: false,
      };
    default:
      throw new Error(`Unsupported cleanup reason ${reason}`);
  }
}

async function clearServiceConnectionStateBestEffort(userID: string, serviceName: ServiceNames): Promise<boolean> {
  try {
    await clearServiceConnectionState(userID, serviceName);
    return true;
  } catch (error: any) {
    logger.error(`Failed to clear service connection state for ${serviceName} and user ${userID}: ${error?.message || error}`);
    return false;
  }
}

async function applyPostCleanupConnectionState(
  userID: string,
  serviceName: ServiceNames,
  reason: ServiceAuthCleanupReason,
  outcome: ServiceAuthCleanupOutcome,
  knownNoTokensRemain = false,
): Promise<void> {
  const policy = resolveCleanupPolicy(reason);
  if (!policy.clearConnectionStateWhenNoTokensRemain) {
    return;
  }
  if (outcome.preservedTokenCount > 0) {
    return;
  }

  if (!knownNoTokensRemain) {
    const remainingTokens = await getServiceTokenCollectionRef(userID, serviceName).limit(1).get();
    if (!remainingTokens.empty) {
      return;
    }
  }

  const cleared = await clearServiceConnectionStateBestEffort(userID, serviceName);
  if (cleared) {
    outcome.connectionStateUpdate = 'cleared';
  }
}

async function fallbackRecursiveDeleteTokenRoot(
  userID: string,
  serviceName: ServiceNames,
  outcome: ServiceAuthCleanupOutcome,
): Promise<void> {
  try {
    await admin.firestore().recursiveDelete(getServiceTokenRootDocumentRef(userID, serviceName));
    outcome.fallbackTokenRootCleanupPerformed = true;
    outcome.localCleanupStatus = 'completed';
    logger.warn(`Completed fallback recursive cleanup for ${serviceName} user ${userID}`);
  } catch (fallbackError) {
    outcome.localCleanupStatus = 'partial';
    logger.error(`Fallback recursive cleanup failed for ${serviceName} user ${userID}`, fallbackError);
  }
}

interface DeleteCurrentTerminalAuthTokenResult {
  latestSnapshot: DocumentSnapshot | null;
  remainingTokenCount: number;
  skippedBecauseTokenChanged: boolean;
  tokenRootDeleted: boolean;
  tokenDeleted: boolean;
}

async function deleteCurrentTerminalAuthToken(
  tokenSnapshot: DocumentSnapshot,
  serviceName: ServiceNames,
): Promise<DeleteCurrentTerminalAuthTokenResult> {
  const userID = tokenSnapshot.ref.parent.parent?.id;
  if (!userID) {
    throw new Error(`Could not resolve user for ${serviceName} token ${tokenSnapshot.id}`);
  }

  const tokenRootRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const tokenCollectionRef = tokenRootRef.collection('tokens');
  const expectedUpdateTime = tokenSnapshot.updateTime || null;

  return admin.firestore().runTransaction(async (transaction) => {
    const currentTokenSnapshot = await transaction.get(tokenSnapshot.ref);
    if (!currentTokenSnapshot.exists) {
      return {
        latestSnapshot: null,
        remainingTokenCount: 0,
        skippedBecauseTokenChanged: true,
        tokenRootDeleted: false,
        tokenDeleted: false,
      };
    }

    if (expectedUpdateTime && currentTokenSnapshot.updateTime
      && currentTokenSnapshot.updateTime.toMillis() !== expectedUpdateTime.toMillis()) {
      return {
        latestSnapshot: currentTokenSnapshot,
        remainingTokenCount: 1,
        skippedBecauseTokenChanged: true,
        tokenRootDeleted: false,
        tokenDeleted: false,
      };
    }

    const tokenQuerySnapshot = await transaction.get(tokenCollectionRef);
    const remainingTokenCount = tokenQuerySnapshot.docs.filter((doc) => doc.id !== tokenSnapshot.id).length;

    transaction.delete(tokenSnapshot.ref);
    if (remainingTokenCount === 0) {
      // Service token roots only store fields on the root document plus the `tokens` subcollection.
      // After deleting the final token doc inside this transaction, the root has no remaining descendants.
      transaction.delete(tokenRootRef);
    }

    return {
      latestSnapshot: currentTokenSnapshot,
      remainingTokenCount,
      skippedBecauseTokenChanged: false,
      tokenRootDeleted: remainingTokenCount === 0,
      tokenDeleted: true,
    };
  });
}

export async function cleanupServiceTokenById(
  userID: string,
  serviceName: ServiceNames,
  tokenID: string,
  reason: ServiceAuthCleanupReason,
): Promise<ServiceAuthCleanupOutcome> {
  const outcome: ServiceAuthCleanupOutcome = {
    reason,
    tokenCount: 1,
    deletedTokenCount: 0,
    preservedTokenCount: 0,
    partnerDeauthorizeAttempted: 0,
    partnerDeauthorizeFailed: 0,
    localCleanupStatus: 'completed',
    connectionStateUpdate: 'unchanged',
    fallbackTokenRootCleanupPerformed: false,
  };

  try {
    const deleteResult = await deleteLocalServiceToken(userID, serviceName, tokenID);
    outcome.deletedTokenCount = 1;
    await applyPostCleanupConnectionState(userID, serviceName, reason, outcome, deleteResult.tokenRootDeleted);
  } catch (error) {
    logger.error(`Failed to delete token ${tokenID} for ${serviceName} user ${userID}`, error);
    outcome.localCleanupStatus = 'partial';
    throw new ServiceTokenCleanupError(userID, serviceName, tokenID, outcome, error);
  }

  return outcome;
}

async function cleanupTerminalAuthToken(
  tokenSnapshot: DocumentSnapshot,
  serviceName: ServiceNames,
  terminalAuthFailure: TerminalAuthFailureInput,
): Promise<{
  latestSnapshot: DocumentSnapshot | null;
  outcome: ServiceAuthCleanupOutcome;
  skippedBecauseTokenChanged: boolean;
}> {
  const userID = tokenSnapshot.ref.parent.parent?.id;
  if (!userID) {
    throw new Error(`Could not resolve user for ${serviceName} token ${tokenSnapshot.id}`);
  }

  const outcome: ServiceAuthCleanupOutcome = {
    reason: SERVICE_AUTH_CLEANUP_REASONS.TerminalAuthFailure,
    tokenCount: 1,
    deletedTokenCount: 0,
    preservedTokenCount: 0,
    partnerDeauthorizeAttempted: 0,
    partnerDeauthorizeFailed: 0,
    localCleanupStatus: 'completed',
    connectionStateUpdate: 'unchanged',
    fallbackTokenRootCleanupPerformed: false,
  };

  try {
    const deleteResult = await deleteCurrentTerminalAuthToken(tokenSnapshot, serviceName);
    if (deleteResult.skippedBecauseTokenChanged) {
      outcome.preservedTokenCount = Math.max(deleteResult.remainingTokenCount, 1);
      return {
        latestSnapshot: deleteResult.latestSnapshot,
        outcome,
        skippedBecauseTokenChanged: true,
      };
    }

    outcome.deletedTokenCount = deleteResult.tokenDeleted ? 1 : 0;
    outcome.tokenCount = 1 + deleteResult.remainingTokenCount;
    outcome.preservedTokenCount = deleteResult.remainingTokenCount;

    if (deleteResult.tokenRootDeleted) {
      try {
        await markServiceReconnectRequired(
          userID,
          serviceName,
          terminalAuthFailure.providerErrorCode,
          terminalAuthFailure.providerErrorMessage,
        );
        outcome.connectionStateUpdate = 'reconnect_required';
      } catch (metaError) {
        logger.error(`Failed to persist reconnect-required state for ${serviceName} user ${userID}`, metaError);
      }
    }

    return {
      latestSnapshot: deleteResult.latestSnapshot,
      outcome,
      skippedBecauseTokenChanged: false,
    };
  } catch (error) {
    logger.error(`Failed to delete terminal auth token ${tokenSnapshot.id} for ${serviceName} user ${userID}`, error);
    outcome.localCleanupStatus = 'partial';
    try {
      await markServiceReconnectRequired(
        userID,
        serviceName,
        terminalAuthFailure.providerErrorCode,
        terminalAuthFailure.providerErrorMessage,
      );
      outcome.connectionStateUpdate = 'reconnect_required';
    } catch (metaError) {
      logger.error(`Failed to persist reconnect-required state for ${serviceName} user ${userID}`, metaError);
    }
    return {
      latestSnapshot: tokenSnapshot,
      outcome,
      skippedBecauseTokenChanged: false,
    };
  }
}

export async function cleanupServiceConnectionForUser(
  userID: string,
  serviceName: ServiceNames,
  reason: ServiceAuthCleanupReason,
  options: CleanupServiceConnectionOptions = {},
): Promise<ServiceAuthCleanupOutcome> {
  const policy = resolveCleanupPolicy(reason);
  const adapter = getServiceAdapter(serviceName);
  const userDocRef = getServiceTokenRootDocumentRef(userID, serviceName);
  const tokenQuerySnapshots = await getServiceTokenCollectionRef(userID, serviceName).get();
  const outcome: ServiceAuthCleanupOutcome = {
    reason,
    tokenCount: tokenQuerySnapshots.size,
    deletedTokenCount: 0,
    preservedTokenCount: 0,
    partnerDeauthorizeAttempted: 0,
    partnerDeauthorizeFailed: 0,
    localCleanupStatus: 'completed',
    connectionStateUpdate: 'unchanged',
    fallbackTokenRootCleanupPerformed: false,
  };

  if (policy.persistReconnectRequired && options.terminalAuthFailure) {
    try {
      await markServiceReconnectRequired(
        userID,
        serviceName,
        options.terminalAuthFailure.providerErrorCode,
        options.terminalAuthFailure.providerErrorMessage,
      );
      outcome.connectionStateUpdate = 'reconnect_required';
    } catch (metaError) {
      logger.error(`Failed to persist reconnect-required state for ${serviceName} user ${userID}`, metaError);
    }
  }

  if (tokenQuerySnapshots.empty) {
    logger.warn(`No tokens found for user ${userID} in ${adapter.tokenCollectionName}. Cleaning up abandoned data.`);
    await admin.firestore().recursiveDelete(userDocRef);
    outcome.localCleanupStatus = 'no_tokens_found';

    await applyPostCleanupConnectionState(userID, serviceName, reason, outcome);

    if ((options.missingTokensBehavior || 'throw') === 'throw') {
      throw new TokenNotFoundError('No tokens found');
    }
    return outcome;
  }

  logger.info(`Found ${tokenQuerySnapshots.size} tokens for user ${userID}`);

  const cleanupErrors: unknown[] = [];
  let knownNoTokensRemain = false;
  for (const tokenQueryDocumentSnapshot of tokenQuerySnapshots.docs) {
    let shouldDeleteToken = true;
    let serviceToken: StoredServiceToken | null = null;

    if (policy.attemptPartnerDeauthorize) {
      try {
        serviceToken = options.tokenResolver
          ? await options.tokenResolver(tokenQueryDocumentSnapshot)
          : buildStoredServiceToken(serviceName, tokenQueryDocumentSnapshot.data() as Auth2ServiceTokenInterface);
      } catch (error: any) {
        const statusCode = error?.statusCode || error?.output?.statusCode;
        if ((statusCode === 500 || statusCode === 502) && policy.preserveLocalTokenOnPartnerFailure) {
          logger.error(`Refreshing token failed with ${statusCode} for ${tokenQueryDocumentSnapshot.id}. Preserving local token.`);
          shouldDeleteToken = false;
        } else {
          logger.warn(`Refreshing token failed for ${tokenQueryDocumentSnapshot.id} (${statusCode || 'unknown error'}). Proceeding with local cleanup.`);
        }
      }

      if (shouldDeleteToken && serviceToken) {
        outcome.partnerDeauthorizeAttempted += 1;
        try {
          await adapter.deauthorize(serviceToken);
          logger.info(`Deauthorized ${serviceName} token ${tokenQueryDocumentSnapshot.id} for ${userID}`);
        } catch (apiError: any) {
          const statusCode = apiError?.statusCode || apiError?.output?.statusCode;
          if ((statusCode === 500 || statusCode === 502) && policy.preserveLocalTokenOnPartnerFailure) {
            logger.error(`${serviceName} API deauthorization failed with ${statusCode} for ${userID}. Preserving local token.`);
            outcome.partnerDeauthorizeFailed += 1;
            shouldDeleteToken = false;
          } else {
            if (statusCode === 500 || statusCode === 502) {
              outcome.partnerDeauthorizeFailed += 1;
            }
            logger.warn(`Failed to deauthorize on ${serviceName} API for ${userID}: ${apiError?.message}. Proceeding with local cleanup.`);
          }
        }
      }
    }

    if (!shouldDeleteToken) {
      outcome.preservedTokenCount += 1;
      continue;
    }

    try {
      const deleteResult = await deleteLocalServiceToken(userID, serviceName, tokenQueryDocumentSnapshot.id);
      outcome.deletedTokenCount += 1;
      knownNoTokensRemain = deleteResult.tokenRootDeleted;
    } catch (deleteError: any) {
      cleanupErrors.push(deleteError);
      logger.error(`Failed to delete local token ${tokenQueryDocumentSnapshot.id}: ${deleteError?.message || deleteError}`);
    }
  }

  if (cleanupErrors.length > 0) {
    outcome.localCleanupStatus = 'partial';
    if (policy.guaranteeLocalCleanup) {
      await fallbackRecursiveDeleteTokenRoot(userID, serviceName, outcome);
      knownNoTokensRemain = true;
    }
  }

  await applyPostCleanupConnectionState(userID, serviceName, reason, outcome, knownNoTokensRemain);
  return outcome;
}

function resolveProviderUserId(
  serviceName: ServiceNames,
  serviceTokenData: Auth2ServiceTokenInterface,
  fallbackID: string,
): string {
  switch (serviceName) {
    case ServiceNames.SuuntoApp:
      return `${(serviceTokenData as any).userName || fallbackID}`;
    case ServiceNames.COROSAPI:
      return `${(serviceTokenData as any).openId || fallbackID}`;
    case ServiceNames.GarminAPI:
      return `${(serviceTokenData as any).userID || fallbackID}`;
    default:
      return fallbackID;
  }
}

export async function handleTerminalServiceAuthFailure(
  doc: DocumentSnapshot,
  serviceName: ServiceNames,
  serviceTokenData: Auth2ServiceTokenInterface,
  failure: RefreshFailureDetails,
  originalError: unknown,
): Promise<TerminalServiceAuthFailureResolution> {
  const firebaseUserID = doc.ref.parent.parent?.id || null;
  const providerUserId = resolveProviderUserId(serviceName, serviceTokenData, doc.id);

  if (!firebaseUserID) {
    try {
      await doc.ref.delete();
      logger.warn(`Deleted token ${doc.id} directly after terminal auth failure because the user root could not be resolved.`);
    } catch (deleteError) {
      logger.error(`Could not delete token ${doc.id} after terminal auth failure`, deleteError);
    }

    return {
      kind: 'terminal_error',
      error: new TerminalServiceAuthError(
        serviceName,
        null,
        providerUserId,
        failure.statusCode,
        failure.providerErrorCode,
        failure.providerErrorMessage,
        originalError,
        {
          reason: SERVICE_AUTH_CLEANUP_REASONS.TerminalAuthFailure,
          tokenCount: 1,
          deletedTokenCount: 1,
          preservedTokenCount: 0,
          partnerDeauthorizeAttempted: 0,
          partnerDeauthorizeFailed: 0,
          localCleanupStatus: 'completed',
          connectionStateUpdate: 'unchanged',
          fallbackTokenRootCleanupPerformed: false,
        },
      ),
    };
  }

  let cleanupOutcome: ServiceAuthCleanupOutcome;
  let latestSnapshot: DocumentSnapshot | null = null;
  try {
    const cleanupResult = await cleanupTerminalAuthToken(
      doc,
      serviceName,
      {
        providerUserId,
        statusCode: failure.statusCode,
        providerErrorCode: failure.providerErrorCode,
        providerErrorMessage: failure.providerErrorMessage,
      },
    );
    cleanupOutcome = cleanupResult.outcome;
    latestSnapshot = cleanupResult.latestSnapshot;

    if (cleanupResult.skippedBecauseTokenChanged && latestSnapshot) {
      logger.info(`Skipping terminal auth cleanup for ${serviceName} token ${doc.id} because a newer token snapshot already exists.`);
      return {
        kind: 'retry_with_latest_snapshot',
        latestSnapshot,
      };
    }
  } catch (cleanupError) {
    logger.error(`Failed to clean up ${serviceName} token ${doc.id} after terminal auth failure. Preserving any newer reconnect state and returning a terminal auth error.`, cleanupError);
    cleanupOutcome = {
      reason: SERVICE_AUTH_CLEANUP_REASONS.TerminalAuthFailure,
      tokenCount: 1,
      deletedTokenCount: 0,
      preservedTokenCount: 0,
      partnerDeauthorizeAttempted: 0,
      partnerDeauthorizeFailed: 0,
      localCleanupStatus: 'partial',
      connectionStateUpdate: 'unchanged',
      fallbackTokenRootCleanupPerformed: false,
    };
    try {
      await markServiceReconnectRequired(
        firebaseUserID,
        serviceName,
        failure.providerErrorCode,
        failure.providerErrorMessage,
      );
      cleanupOutcome.connectionStateUpdate = 'reconnect_required';
    } catch (metaError) {
      logger.error(`Failed to persist reconnect-required state for ${serviceName} user ${firebaseUserID}`, metaError);
    }
  }

  const terminalError = new TerminalServiceAuthError(
    serviceName,
    firebaseUserID,
    providerUserId,
    failure.statusCode,
    failure.providerErrorCode,
    failure.providerErrorMessage,
    originalError,
    cleanupOutcome,
  );

  logger.warn('Service auth failure requires reconnect', {
    serviceName,
    firebaseUserID,
    providerUserId,
    statusCode: failure.statusCode,
    providerErrorCode: failure.providerErrorCode,
    providerErrorMessage: failure.providerErrorMessage,
    dlqContext: terminalError.dlqContext,
    cleanupOutcome,
  });

  return {
    kind: 'terminal_error',
    error: terminalError,
  };
}
