import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { HEALTH_PROVIDERS, HEALTH_SYNC_STATUSES } from '../../../shared/health';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import {
  increaseRetryCountForQueueItem,
  isCurrentSleepQueueTransition,
  markQueueItemSkipped,
  moveToDeadLetterQueueIfCurrentAndNotCleanupTombstoned,
  moveToDeadLetterQueueIfCurrentUserActive,
  QUEUE_SKIPPED_REASONS,
  QueueResult,
} from '../queue-utils';
import * as requestPromise from '../request-helper';
import {
  getUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';
import { clearRevisionProcessingLeaseUpdate } from '../queue/revision-processing-lease';
import { getExpireAtTimestamp, TTL_CONFIG } from '../shared/ttl-config';
import {
  areTokenCredentialSnapshotsEqual,
  getTokenCredentialSnapshot,
} from '../token-refresh-coordinator';
import { TerminalServiceAuthError, TokenRefreshSkippedForDeletedUserError } from '../tokens';
import { updateHealthSyncState } from '../health/writer';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME } from '../sleep/constants';
import {
  captureActiveGarminHealthWriteLifecycleGuards,
  GarminHealthAccountValidationError,
  type GarminHealthWriteLifecycleGuards,
} from './health-lifecycle';
import {
  assertGarminHealthPermission,
  GarminHealthPermissionError,
  refreshAndCaptureGarminHealthGuards,
  verifyLegacyGarminProviderIdentity,
} from './health-sync';
import { isGarminHealthSyncEnabled } from './health-flags';
import {
  advanceGarminHealthBackfillCursor,
  clipGarminHealthBackfillCursorToMinimum,
  countGarminHealthBackfillRequests,
  GARMIN_HEALTH_BACKFILL_ENDPOINTS,
  getGarminHealthBackfillWindow,
  isCompleteGarminHealthBackfillCursor,
  type GarminHealthBackfillCursor,
} from './health-backfill-range';
import { GARMIN_HEALTH_SUMMARY_TYPES } from './health-summary-types';
import {
  extractGarminBackfillMinimumStartMs,
  getGarminBackfillStatusCode,
  isGarminBackfillMinimumStartError,
} from './backfill-error';

const GARMIN_HEALTH_BACKFILL_BASE_URI = 'https://apis.garmin.com/wellness-api/rest/backfill';
const GARMIN_HEALTH_BACKFILL_RESPONSE_BYTES = 16 * 1024;
const GARMIN_HEALTH_BACKFILL_REQUEST_TIMEOUT_MS = 30_000;
export const GARMIN_HEALTH_BACKFILL_REQUEST_PACING_MS = 1_500;

type TokenSnapshot = admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;

class GarminHealthBackfillValidationError extends Error {
  readonly name = 'GarminHealthBackfillValidationError';
  constructor() {
    super('Garmin Health backfill job is invalid.');
  }
}

class GarminHealthBackfillRequestError extends Error {
  readonly name = 'GarminHealthBackfillRequestError';
  constructor(readonly statusCode: number | null) {
    super('Garmin Health backfill request failed.');
  }
}

function queueFenceMatches(
  queueItem: SleepSyncQueueItemInterface,
  guards: GarminHealthWriteLifecycleGuards,
): boolean {
  return queueItem.garminHealthTokenCredentialGeneration === guards.tokenCredentialGeneration
    && queueItem.garminHealthRootOAuthCredentialGeneration === guards.rootOAuthCredentialGeneration
    && queueItem.garminHealthConnectionStateGeneration === guards.connectionStateGeneration;
}

function parseCursor(queueItem: SleepSyncQueueItemInterface): {
  rangeStartMs: number;
  rangeEndMs: number;
  total: number;
  cursor: GarminHealthBackfillCursor;
} {
  const rangeStartMs = Number(queueItem.rangeStartMs);
  const rangeEndMs = Number(queueItem.rangeEndMs);
  const total = Number(queueItem.garminHealthBackfillWindowsTotal);
  const cursor = {
    summaryIndex: Number(queueItem.garminHealthBackfillSummaryIndex),
    nextStartMs: Number(queueItem.garminHealthBackfillNextStartMs),
    windowsCompleted: Number(queueItem.garminHealthBackfillWindowsCompleted),
  };
  try {
    if (queueItem.type !== 'garmin_health_backfill'
      || queueItem.provider !== SLEEP_PROVIDERS.GarminAPI
      || queueItem.healthTrigger !== 'backfill'
      || typeof queueItem.userID !== 'string'
      || !queueItem.userID.trim()
      || typeof queueItem.providerUserId !== 'string'
      || !queueItem.providerUserId.trim()
      || !Number.isSafeInteger(total)
      || total <= 0
      || !Number.isSafeInteger(cursor.windowsCompleted)
      || cursor.windowsCompleted < 0
      || cursor.windowsCompleted > total
      || isCompleteGarminHealthBackfillCursor(cursor)) {
      throw new Error('invalid');
    }
    // This validates the summary index and whole-second range/cursor invariants.
    getGarminHealthBackfillWindow(cursor, rangeEndMs);
    if (!Number.isSafeInteger(rangeStartMs)
      || !Number.isSafeInteger(rangeEndMs)
      || rangeStartMs < 0
      || rangeEndMs < rangeStartMs
      || rangeStartMs % 1_000 !== 0
      || rangeEndMs % 1_000 !== 0
      || cursor.nextStartMs < rangeStartMs
      || cursor.nextStartMs > rangeEndMs
      || total !== countGarminHealthBackfillRequests(rangeStartMs, rangeEndMs)) {
      throw new Error('invalid');
    }
  } catch {
    throw new GarminHealthBackfillValidationError();
  }
  return { rangeStartMs, rangeEndMs, total, cursor };
}

async function findExactToken(
  userID: string,
  providerUserId: string,
): Promise<TokenSnapshot | null> {
  const snapshot = await admin.firestore()
    .collection('garminAPITokens')
    .doc(userID)
    .collection('tokens')
    .where('serviceName', '==', ServiceNames.GarminAPI)
    .where('userID', '==', providerUserId)
    .limit(1)
    .get();
  return snapshot.docs[0] || null;
}

async function captureFencedGuards(
  queueItem: SleepSyncQueueItemInterface,
  tokenSnapshot: TokenSnapshot,
): Promise<GarminHealthWriteLifecycleGuards | null> {
  const guards = await captureActiveGarminHealthWriteLifecycleGuards(
    admin.firestore(),
    queueItem.userID!,
    queueItem.providerUserId,
    tokenSnapshot,
  );
  return guards && queueFenceMatches(queueItem, guards) ? guards : null;
}

function documentMatchesExpectedFields(
  snapshot: admin.firestore.DocumentSnapshot,
  expectedFields: Readonly<Record<string, unknown>>,
): boolean {
  if (!snapshot.exists) return false;
  const data = snapshot.data() as Record<string, unknown> | undefined;
  return Boolean(data) && Object.entries(expectedFields)
    .every(([field, expected]) => data?.[field] === expected);
}

async function lifecycleMatchesInTransaction(
  transaction: admin.firestore.Transaction,
  guards: GarminHealthWriteLifecycleGuards,
): Promise<boolean> {
  const tokenSnapshot = await transaction.get(guards.requiredExistingDocumentRef);
  if (!tokenSnapshot.exists
    || !areTokenCredentialSnapshotsEqual(
      getTokenCredentialSnapshot(tokenSnapshot.data() as Record<string, unknown> | undefined),
      guards.requiredExistingTokenCredential,
    )) {
    return false;
  }
  const fieldGuards = [
    ...(guards.requiredDocumentFieldValues ? [guards.requiredDocumentFieldValues] : []),
    ...(guards.additionalRequiredDocumentFieldValues || []),
  ];
  const snapshots = await Promise.all(fieldGuards.map(guard => transaction.get(guard.documentRef)));
  return snapshots.every((snapshot, index) => documentMatchesExpectedFields(
    snapshot,
    fieldGuards[index].expectedFields,
  ));
}

function cursorsMatch(
  left: GarminHealthBackfillCursor,
  right: GarminHealthBackfillCursor,
): boolean {
  return left.summaryIndex === right.summaryIndex
    && left.nextStartMs === right.nextStartMs
    && left.windowsCompleted === right.windowsCompleted;
}

async function isCurrentQueueCursor(
  queueItem: SleepSyncQueueItemInterface,
  expectedCursor: GarminHealthBackfillCursor,
): Promise<boolean> {
  const snapshot = await queueItem.ref!.get();
  if (!snapshot.exists) return false;
  const current = snapshot.data() as SleepSyncQueueItemInterface;
  if (current.processed
    || current.userID !== queueItem.userID
    || current.type !== 'garmin_health_backfill'
    || !isCurrentSleepQueueTransition(current as unknown as Record<string, unknown>, queueItem)) {
    return false;
  }
  try {
    return cursorsMatch(parseCursor(current).cursor, expectedCursor);
  } catch {
    return false;
  }
}

async function advanceCursorTransaction(
  queueItem: SleepSyncQueueItemInterface,
  expectedCursor: GarminHealthBackfillCursor,
  nextCursor: GarminHealthBackfillCursor,
  total: number,
  guards: GarminHealthWriteLifecycleGuards,
): Promise<'advanced' | 'superseded' | 'deleted' | 'lifecycle_changed'> {
  const db = admin.firestore();
  const stateRef = db.collection('users').doc(queueItem.userID!)
    .collection('sleepSyncState').doc(SLEEP_PROVIDERS.GarminAPI);
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        queueItem.userID!,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(
        queueItem.userID!,
        'garmin_health_backfill_progress',
        error,
      );
    }
    if (deletionGuard.shouldSkip) return 'deleted';

    const queueSnapshot = await transaction.get(queueItem.ref!);
    if (!queueSnapshot.exists) return 'superseded';
    const current = queueSnapshot.data() as SleepSyncQueueItemInterface;
    if (!isCurrentSleepQueueTransition(current as unknown as Record<string, unknown>, queueItem)
      || current.userID !== queueItem.userID
      || current.type !== 'garmin_health_backfill') {
      return 'superseded';
    }
    const currentCursor = parseCursor(current).cursor;
    if (!cursorsMatch(currentCursor, expectedCursor)) {
      return 'superseded';
    }
    if (!(await lifecycleMatchesInTransaction(transaction, guards))) {
      return 'lifecycle_changed';
    }

    const complete = isCompleteGarminHealthBackfillCursor(nextCursor);
    transaction.update(queueItem.ref!, {
      garminHealthBackfillSummaryIndex: nextCursor.summaryIndex,
      garminHealthBackfillNextStartMs: nextCursor.nextStartMs,
      garminHealthBackfillWindowsCompleted: complete ? total : nextCursor.windowsCompleted,
      retryCount: 0,
      ...(complete ? {
        processed: true,
        processedAt: Date.now(),
        resultStatus: 'success',
        dispatchedToCloudTask: null,
        expireAt: getExpireAtTimestamp(TTL_CONFIG.QUEUE_ITEM_IN_DAYS),
      } : {}),
    });
    transaction.set(stateRef, {
      provider: SLEEP_PROVIDERS.GarminAPI,
      healthBackfillStatus: complete ? 'complete' : 'running',
      healthBackfillWindowsCompleted: complete ? total : nextCursor.windowsCompleted,
      healthBackfillWindowsTotal: total,
      healthBackfillSummaryType: complete
        ? null
        : GARMIN_HEALTH_SUMMARY_TYPES[nextCursor.summaryIndex],
      updatedAtMs: Date.now(),
    }, { merge: true });
    return 'advanced';
  });
}

function stateBelongsToBackfillQueue(
  state: Record<string, unknown>,
  rangeEndMs: number,
  total: number,
): boolean {
  const status = state.healthBackfillStatus;
  const queuedAtMs = state.lastBackfillQueuedAtMs;
  const endMs = state.lastBackfillEndMs;
  const windowsTotal = state.healthBackfillWindowsTotal;
  return state.provider === SLEEP_PROVIDERS.GarminAPI
    && (status === 'queued' || status === 'running')
    && typeof queuedAtMs === 'number'
    && Number.isSafeInteger(queuedAtMs)
    && Math.floor(queuedAtMs / 1_000) * 1_000 === rangeEndMs
    && typeof endMs === 'number'
    && Number.isSafeInteger(endMs)
    && Math.floor(endMs / 1_000) * 1_000 === rangeEndMs
    && windowsTotal === total;
}

async function markBackfillSkipped(
  queueItem: SleepSyncQueueItemInterface,
  total: number,
  skippedReason = 'user_or_provider_lifecycle_changed',
  skippedContext = 'USER_OR_PROVIDER_LIFECYCLE_GUARD',
): Promise<QueueResult> {
  const db = admin.firestore();
  const stateRef = db.collection('users').doc(queueItem.userID!)
    .collection('sleepSyncState').doc(SLEEP_PROVIDERS.GarminAPI);
  const nowMs = Date.now();
  try {
    const transition = await db.runTransaction(async transaction => {
      let deletionGuard;
      try {
        deletionGuard = await getUserDeletionGuardStateInTransaction(
          db,
          transaction,
          queueItem.userID!,
        );
      } catch (error) {
        throw new UserDeletionGuardReadError(
          queueItem.userID!,
          'garmin_health_backfill_lifecycle_skip',
          error,
        );
      }
      if (deletionGuard.shouldSkip) return 'deleted';

      const [queueSnapshot, stateSnapshot] = await Promise.all([
        transaction.get(queueItem.ref!),
        transaction.get(stateRef),
      ]);
      if (!queueSnapshot.exists) return 'superseded';
      const current = queueSnapshot.data() as SleepSyncQueueItemInterface;
      if (current.processed
        || current.userID !== queueItem.userID
        || current.type !== 'garmin_health_backfill'
        || current.garminHealthBackfillWindowsTotal !== total
        || !isCurrentSleepQueueTransition(current as unknown as Record<string, unknown>, queueItem)) {
        return 'superseded';
      }

      transaction.update(queueItem.ref!, {
        processed: true,
        processedAt: nowMs,
        resultStatus: 'skipped',
        skippedReason,
        skippedContext,
        ...clearRevisionProcessingLeaseUpdate(),
      });
      const state = stateSnapshot.exists
        ? stateSnapshot.data() as Record<string, unknown>
        : null;
      if (state && stateBelongsToBackfillQueue(state, Number(current.rangeEndMs), total)) {
        transaction.set(stateRef, {
          provider: SLEEP_PROVIDERS.GarminAPI,
          healthBackfillStatus: 'skipped',
          healthBackfillSummaryType: null,
          updatedAtMs: nowMs,
        }, { merge: true });
      }
      return 'skipped';
    });
    if (transition === 'deleted') {
      return markQueueItemSkipped(
        queueItem,
        undefined,
        QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
        { skippedContext: 'USER_DELETION_GUARD' },
      );
    }
    return QueueResult.Processed;
  } catch (error) {
    logger.error('[GarminHealthBackfill] Could not persist skipped backfill progress.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return QueueResult.Failed;
  }
}

async function updateMatchingBackfillStateInTransaction(
  transaction: admin.firestore.Transaction,
  currentQueueItem: Record<string, unknown>,
  expectedUserID: string,
  update: Record<string, unknown>,
  expectedTotal?: number,
): Promise<void> {
  const total = Number(currentQueueItem.garminHealthBackfillWindowsTotal);
  const rangeEndMs = Number(currentQueueItem.rangeEndMs);
  if (currentQueueItem.type !== 'garmin_health_backfill'
    || currentQueueItem.userID !== expectedUserID
    || !Number.isSafeInteger(total)
    || total <= 0
    || (expectedTotal !== undefined && total !== expectedTotal)
    || !Number.isSafeInteger(rangeEndMs)
    || rangeEndMs < 0) {
    return;
  }
  const stateRef = admin.firestore().collection('users').doc(expectedUserID)
    .collection('sleepSyncState').doc(SLEEP_PROVIDERS.GarminAPI);
  const stateSnapshot = await transaction.get(stateRef);
  const state = stateSnapshot.exists
    ? stateSnapshot.data() as Record<string, unknown>
    : null;
  if (!state || !stateBelongsToBackfillQueue(state, rangeEndMs, total)) return;
  transaction.set(stateRef, {
    provider: SLEEP_PROVIDERS.GarminAPI,
    healthBackfillSummaryType: null,
    updatedAtMs: Date.now(),
    ...update,
  }, { merge: true });
}

function terminalBackfillProgressError(context: string): string {
  if (context.includes('PERMISSION')) {
    return 'Garmin Health backfill permission is unavailable.';
  }
  if (context.includes('AUTH') || context === 'INVALID_GRANT') {
    return 'Garmin Health backfill authorization failed.';
  }
  if (context.includes('INVALID')) {
    return 'Garmin Health backfill ended because the provider request was invalid.';
  }
  return 'Garmin Health backfill ended with a terminal error.';
}

async function moveToDlq(
  queueItem: SleepSyncQueueItemInterface,
  error: Error,
  context: string,
): Promise<QueueResult> {
  const userID = typeof queueItem.userID === 'string' ? queueItem.userID.trim() : '';
  if (!userID) {
    return moveToDeadLetterQueueIfCurrentAndNotCleanupTombstoned({
      queueItem,
      error,
      context,
      collectionName: SLEEP_SYNC_QUEUE_COLLECTION_NAME,
      logPrefix: 'GarminHealthBackfillLegacy',
      isCurrent: current => isCurrentSleepQueueTransition(current, queueItem),
    });
  }
  return moveToDeadLetterQueueIfCurrentUserActive({
    queueItem,
    error,
    context,
    userID,
    phase: `garmin_health_backfill_dlq:${context}`,
    logPrefix: 'GarminHealthBackfill',
    isCurrent: current => isCurrentSleepQueueTransition(current, queueItem),
    onBeforeMoveInTransaction: (transaction, currentQueueItem) => (
      updateMatchingBackfillStateInTransaction(
        transaction,
        currentQueueItem,
        userID,
        {
          healthBackfillStatus: 'failed',
          lastError: terminalBackfillProgressError(context),
        },
      )
    ),
  });
}

async function recordTerminalHealthFailure(
  queueItem: SleepSyncQueueItemInterface,
  guards: GarminHealthWriteLifecycleGuards,
  error: GarminHealthBackfillRequestError | GarminHealthPermissionError,
): Promise<void> {
  const permissionMissing = error instanceof GarminHealthPermissionError
    || error.statusCode === 412;
  await updateHealthSyncState(queueItem.userID!, HEALTH_PROVIDERS.GarminAPI, {
    status: permissionMissing
      ? HEALTH_SYNC_STATUSES.PermissionMissing
      : HEALTH_SYNC_STATUSES.ReconnectRequired,
    lastErrorCode: permissionMissing
      ? 'garmin_health_backfill_permission_missing'
      : 'garmin_health_backfill_auth_required',
  }, Date.now(), guards);
}

async function retryGarminHealthBackfill(
  queueItem: SleepSyncQueueItemInterface,
  total: number,
  error: GarminHealthBackfillRequestError,
): Promise<QueueResult> {
  return increaseRetryCountForQueueItem(
    queueItem,
    error,
    1,
    undefined,
    'GARMIN_HEALTH_BACKFILL_RETRIES_EXHAUSTED',
    (transaction, currentQueueItem) => updateMatchingBackfillStateInTransaction(
      transaction,
      currentQueueItem,
      queueItem.userID!,
      {
        healthBackfillStatus: 'failed',
        lastError: 'Garmin Health backfill exhausted automatic retries.',
      },
      total,
    ),
  );
}

async function handleCredentialFailure(
  queueItem: SleepSyncQueueItemInterface,
  total: number,
  guards: GarminHealthWriteLifecycleGuards,
  error: unknown,
): Promise<QueueResult> {
  if (error instanceof TokenRefreshSkippedForDeletedUserError) {
    return markQueueItemSkipped(
      queueItem,
      undefined,
      QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
      { skippedContext: 'USER_DELETION_GUARD' },
    );
  }
  if (error instanceof GarminHealthPermissionError) {
    await recordTerminalHealthFailure(queueItem, guards, error);
    return moveToDlq(queueItem, error, 'GARMIN_HEALTH_BACKFILL_PERMISSION_MISSING');
  }
  if (error instanceof TerminalServiceAuthError) {
    return moveToDlq(
      queueItem,
      new GarminHealthBackfillRequestError(error.statusCode),
      error.dlqContext,
    );
  }
  if (error instanceof GarminHealthAccountValidationError) {
    return markBackfillSkipped(queueItem, total);
  }
  const statusCode = getGarminBackfillStatusCode(error);
  if (statusCode === 401 || statusCode === 403 || statusCode === 412) {
    const terminalError = statusCode === 412
      ? new GarminHealthPermissionError(queueItem.userID!)
      : new GarminHealthBackfillRequestError(statusCode);
    await recordTerminalHealthFailure(queueItem, guards, terminalError);
    return moveToDlq(
      queueItem,
      terminalError,
      statusCode === 412
        ? 'GARMIN_HEALTH_BACKFILL_PERMISSION_MISSING'
        : 'GARMIN_HEALTH_BACKFILL_AUTH_REQUIRED',
    );
  }
  if (statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return moveToDlq(
      queueItem,
      new GarminHealthBackfillRequestError(statusCode),
      'GARMIN_HEALTH_BACKFILL_INVALID_REQUEST',
    );
  }
  const telemetryError = new GarminHealthBackfillRequestError(statusCode);
  logger.warn('[GarminHealthBackfill] Transient credential or lifecycle read failure.', {
    statusCode: telemetryError.statusCode,
  });
  return retryGarminHealthBackfill(queueItem, total, telemetryError);
}

async function sleepForPacing(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, GARMIN_HEALTH_BACKFILL_REQUEST_PACING_MS));
}

export async function processGarminHealthBackfillQueueItem(
  queueItem: SleepSyncQueueItemInterface,
): Promise<QueueResult> {
  let parsed;
  try {
    parsed = parseCursor(queueItem);
  } catch (error) {
    return moveToDlq(
      queueItem,
      error instanceof Error ? error : new GarminHealthBackfillValidationError(),
      'INVALID_GARMIN_HEALTH_BACKFILL_JOB',
    );
  }

  if (!isGarminHealthSyncEnabled()) {
    return markBackfillSkipped(
      queueItem,
      parsed.total,
      'provider_disabled',
      'GARMIN_HEALTH_DISABLED',
    );
  }

  let deletionGuard;
  try {
    deletionGuard = await getUserDeletionGuardState(admin.firestore(), queueItem.userID!);
  } catch (error) {
    throw new UserDeletionGuardReadError(
      queueItem.userID!,
      'garmin_health_backfill_before_token',
      error,
    );
  }
  if (deletionGuard.shouldSkip) {
    return markQueueItemSkipped(
      queueItem,
      undefined,
      QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
      { skippedContext: 'USER_DELETION_GUARD' },
    );
  }

  const tokenSnapshot = await findExactToken(queueItem.userID!, queueItem.providerUserId);
  if (!tokenSnapshot) return markBackfillSkipped(queueItem, parsed.total);
  const initialGuards = await captureFencedGuards(queueItem, tokenSnapshot);
  if (!initialGuards) return markBackfillSkipped(queueItem, parsed.total);

  let refreshed;
  try {
    refreshed = await refreshAndCaptureGarminHealthGuards(
      queueItem,
      tokenSnapshot,
      queueItem.userID!,
      initialGuards,
    );
    if (!queueFenceMatches(queueItem, refreshed.lifecycleGuards)) {
      return markBackfillSkipped(queueItem, parsed.total);
    }
    assertGarminHealthPermission(refreshed.tokenData, queueItem.userID!);
    if (!refreshed.lifecycleGuards.providerIdentityPinned) {
      await verifyLegacyGarminProviderIdentity(
        refreshed.tokenData.accessToken,
        queueItem.providerUserId,
      );
    }
  } catch (error) {
    return handleCredentialFailure(
      queueItem,
      parsed.total,
      refreshed?.lifecycleGuards || initialGuards,
      error,
    );
  }

  let cursor = parsed.cursor;
  let requestCount = 0;
  while (!isCompleteGarminHealthBackfillCursor(cursor)) {
    if (requestCount > 0) await sleepForPacing();

    // Pacing happens first so every external request is immediately preceded by
    // fresh queue, deletion, and provider-lifecycle checks.
    if (!(await isCurrentQueueCursor(queueItem, cursor))) {
      return QueueResult.Processed;
    }
    if (!isGarminHealthSyncEnabled()) {
      return markBackfillSkipped(
        queueItem,
        parsed.total,
        'provider_disabled',
        'GARMIN_HEALTH_DISABLED',
      );
    }
    let currentGuards: GarminHealthWriteLifecycleGuards;
    try {
      const latestTokenSnapshot = await refreshed.tokenSnapshot.ref.get();
      if (!latestTokenSnapshot.exists) {
        return markBackfillSkipped(queueItem, parsed.total);
      }
      refreshed = await refreshAndCaptureGarminHealthGuards(
        queueItem,
        latestTokenSnapshot,
        queueItem.userID!,
        refreshed.lifecycleGuards,
      );
      if (!queueFenceMatches(queueItem, refreshed.lifecycleGuards)) {
        return markBackfillSkipped(queueItem, parsed.total);
      }
      assertGarminHealthPermission(refreshed.tokenData, queueItem.userID!);
      currentGuards = refreshed.lifecycleGuards;
    } catch (error) {
      return handleCredentialFailure(
        queueItem,
        parsed.total,
        refreshed.lifecycleGuards,
        error,
      );
    }
    const beforeRequestGuard = await getUserDeletionGuardState(
      admin.firestore(),
      queueItem.userID!,
    );
    if (beforeRequestGuard.shouldSkip) {
      return markQueueItemSkipped(
        queueItem,
        undefined,
        QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
        { skippedContext: 'USER_DELETION_GUARD' },
      );
    }
    const window = getGarminHealthBackfillWindow(cursor, parsed.rangeEndMs);
    if (!window) return QueueResult.Processed;
    let nextCursor: GarminHealthBackfillCursor;
    try {
      await requestPromise.get({
        headers: { Authorization: `Bearer ${refreshed.tokenData.accessToken}` },
        maxResponseBytes: GARMIN_HEALTH_BACKFILL_RESPONSE_BYTES,
        timeout: GARMIN_HEALTH_BACKFILL_REQUEST_TIMEOUT_MS,
        url: `${GARMIN_HEALTH_BACKFILL_BASE_URI}/${GARMIN_HEALTH_BACKFILL_ENDPOINTS[window.summaryType]}`
          + `?summaryStartTimeInSeconds=${Math.floor(window.startMs / 1_000)}`
          + `&summaryEndTimeInSeconds=${Math.floor(window.endMs / 1_000)}`,
      });
      nextCursor = advanceGarminHealthBackfillCursor(
        cursor,
        parsed.rangeStartMs,
        parsed.rangeEndMs,
      );
    } catch (error) {
      const statusCode = getGarminBackfillStatusCode(error);
      if (statusCode === 409) {
        nextCursor = advanceGarminHealthBackfillCursor(
          cursor,
          parsed.rangeStartMs,
          parsed.rangeEndMs,
        );
      } else if (isGarminBackfillMinimumStartError(error)) {
        const minimumStartMs = extractGarminBackfillMinimumStartMs(error);
        if (minimumStartMs === null) {
          return moveToDlq(
            queueItem,
            new GarminHealthBackfillRequestError(statusCode),
            'GARMIN_HEALTH_BACKFILL_INVALID_RANGE',
          );
        }
        if (minimumStartMs < cursor.nextStartMs) {
          return moveToDlq(
            queueItem,
            new GarminHealthBackfillRequestError(statusCode),
            'GARMIN_HEALTH_BACKFILL_INVALID_RANGE',
          );
        }
        nextCursor = clipGarminHealthBackfillCursorToMinimum(
          cursor,
          parsed.rangeStartMs,
          parsed.rangeEndMs,
          minimumStartMs,
        );
      } else if (statusCode === 401 || statusCode === 403 || statusCode === 412) {
        const terminalError = statusCode === 412
          ? new GarminHealthPermissionError(queueItem.userID!)
          : new GarminHealthBackfillRequestError(statusCode);
        await recordTerminalHealthFailure(queueItem, currentGuards, terminalError);
        return moveToDlq(
          queueItem,
          terminalError,
          statusCode === 412
            ? 'GARMIN_HEALTH_BACKFILL_PERMISSION_MISSING'
            : 'GARMIN_HEALTH_BACKFILL_AUTH_REQUIRED',
        );
      } else if (statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        return moveToDlq(
          queueItem,
          new GarminHealthBackfillRequestError(statusCode),
          'GARMIN_HEALTH_BACKFILL_INVALID_REQUEST',
        );
      } else {
        const telemetryError = new GarminHealthBackfillRequestError(statusCode);
        logger.warn('[GarminHealthBackfill] Transient provider request failure.', { statusCode });
        return retryGarminHealthBackfill(queueItem, parsed.total, telemetryError);
      }
    }
    requestCount += 1;

    const transition = await advanceCursorTransaction(
      queueItem,
      cursor,
      nextCursor,
      parsed.total,
      currentGuards,
    );
    if (transition === 'deleted') {
      return markQueueItemSkipped(
        queueItem,
        undefined,
        QUEUE_SKIPPED_REASONS.UserDeletedOrDeleting,
        { skippedContext: 'USER_DELETION_GUARD' },
      );
    }
    if (transition === 'lifecycle_changed') return markBackfillSkipped(queueItem, parsed.total);
    if (transition === 'superseded') return QueueResult.Processed;
    cursor = nextCursor;
  }

  return QueueResult.Processed;
}
