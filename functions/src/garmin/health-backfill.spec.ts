import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { QueueResult } from '../queue-utils';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';

const hoisted = vi.hoisted(() => ({
  requestGet: vi.fn(),
  captureGuards: vi.fn(),
  refreshGuards: vi.fn(),
  verifyLegacyIdentity: vi.fn(),
  assertPermission: vi.fn(),
  guardsContinuous: vi.fn(),
  tokenMatchesGuard: vi.fn(),
  getDeletionGuard: vi.fn(),
  getDeletionGuardInTransaction: vi.fn(),
  markSkipped: vi.fn(),
  moveDlq: vi.fn(),
  moveLegacyDlq: vi.fn(),
  increaseRetry: vi.fn(),
  updateSleepState: vi.fn(),
  updateHealthState: vi.fn(),
  transactionSet: vi.fn(),
  queueData: {} as Record<string, unknown>,
  sleepStateData: {} as Record<string, unknown>,
}));

const tokenData = {
  accessToken: 'access-token',
  userID: 'garmin-user-1',
  serviceName: ServiceNames.GarminAPI,
  tokenCredentialGeneration: 'token-generation-1',
  permissions: ['HEALTH_EXPORT'],
};
const tokenRef = {
  get: vi.fn(async () => ({ exists: true, data: () => tokenData })),
};
const metaRef = {
  get: vi.fn(async () => ({
    exists: true,
    data: () => ({ connectionStateGeneration: 'connection-generation-1' }),
  })),
};
const rootRef = {
  get: vi.fn(async () => ({
    exists: true,
    data: () => ({ activeOAuthCredentialGeneration: 'root-generation-1' }),
  })),
};
const tokenSnapshot = {
  exists: true,
  ref: tokenRef,
  data: () => tokenData,
};
const guards = {
  requiredExistingDocumentRef: tokenRef,
  requiredExistingTokenCredential: {
    accessToken: 'access-token',
    refreshToken: '',
    expiresAt: 0,
    dateCreated: 0,
    dateRefreshed: 0,
    credentialGeneration: 'token-generation-1',
  },
  requiredDocumentFieldValues: {
    documentRef: metaRef,
    expectedFields: { connectionStateGeneration: 'connection-generation-1' },
  },
  additionalRequiredDocumentFieldValues: [{
    documentRef: rootRef,
    expectedFields: { activeOAuthCredentialGeneration: 'root-generation-1' },
  }],
  providerUserId: 'garmin-user-1',
  providerIdentityPinned: true,
  tokenCredentialGeneration: 'token-generation-1',
  rootOAuthCredentialGeneration: 'root-generation-1',
  connectionStateGeneration: 'connection-generation-1',
};
const queueRef = {
  parent: { id: 'sleepSyncQueue' },
  get: vi.fn(async () => ({ exists: true, data: () => ({ ...hoisted.queueData }) })),
};

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('firebase-admin', () => {
  const tokenQuery = {
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(async () => ({ docs: [tokenSnapshot] })),
  };
  tokenQuery.where.mockReturnValue(tokenQuery);
  tokenQuery.limit.mockReturnValue(tokenQuery);
  const firestore = vi.fn(() => ({
    collection: vi.fn((name: string) => ({
      doc: vi.fn(() => name === 'garminAPITokens'
        ? { collection: vi.fn(() => tokenQuery) }
        : { collection: vi.fn(() => ({ doc: vi.fn(() => ({ id: 'state-ref' })) })) }),
    })),
    runTransaction: vi.fn(async (runner: (transaction: {
      get: (ref: unknown) => Promise<unknown>;
      update: (ref: unknown, data: Record<string, unknown>) => void;
      set: (ref: unknown, data: Record<string, unknown>, options: unknown) => void;
    }) => Promise<unknown>) => runner({
      get: async (ref) => {
        if (ref === queueRef) {
          return { exists: true, data: () => ({ ...hoisted.queueData }) };
        }
        if (ref === tokenRef) return tokenRef.get();
        if (ref === metaRef) return metaRef.get();
        if (ref === rootRef) return rootRef.get();
        if ((ref as { id?: unknown })?.id === 'state-ref') {
          return { exists: true, data: () => ({ ...hoisted.sleepStateData }) };
        }
        return { exists: true, data: () => ({}) };
      },
      update: (_ref, data) => Object.assign(hoisted.queueData, data),
      set: (_ref, data, options) => hoisted.transactionSet(data, options),
    })),
  }));
  return { firestore };
});
vi.mock('../request-helper', () => ({ get: hoisted.requestGet }));
vi.mock('../queue-utils', async importOriginal => ({
  ...(await importOriginal<typeof import('../queue-utils')>()),
  isCurrentSleepQueueTransition: vi.fn(() => true),
  markQueueItemSkipped: hoisted.markSkipped,
  moveToDeadLetterQueueIfCurrentUserActive: hoisted.moveDlq,
  moveToDeadLetterQueueIfCurrentAndNotCleanupTombstoned: hoisted.moveLegacyDlq,
  increaseRetryCountForQueueItem: hoisted.increaseRetry,
}));
vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: hoisted.getDeletionGuard,
  getUserDeletionGuardStateInTransaction: hoisted.getDeletionGuardInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {},
}));
vi.mock('../shared/ttl-config', () => ({
  TTL_CONFIG: { QUEUE_ITEM_IN_DAYS: 7 },
  getExpireAtTimestamp: vi.fn(() => 'expiry'),
}));
vi.mock('../health/writer', () => ({ updateHealthSyncState: hoisted.updateHealthState }));
vi.mock('../sleep/writer', () => ({ updateSleepSyncState: hoisted.updateSleepState }));
vi.mock('../tokens', () => ({
  TerminalServiceAuthError: class TerminalServiceAuthError extends Error {},
  TokenRefreshSkippedForDeletedUserError: class TokenRefreshSkippedForDeletedUserError extends Error {},
}));
vi.mock('./health-lifecycle', () => ({
  GarminHealthAccountValidationError: class GarminHealthAccountValidationError extends Error {},
  captureActiveGarminHealthWriteLifecycleGuards: hoisted.captureGuards,
  areGarminHealthWriteLifecycleGuardsContinuous: hoisted.guardsContinuous,
  doesGarminHealthTokenDataMatchGuard: hoisted.tokenMatchesGuard,
}));
vi.mock('./health-sync', () => {
  class GarminHealthPermissionError extends Error {
    constructor(public readonly userID: string) {
      super('permission missing');
    }
  }
  return {
    GarminHealthPermissionError,
    assertGarminHealthPermission: hoisted.assertPermission,
    refreshAndCaptureGarminHealthGuards: hoisted.refreshGuards,
    verifyLegacyGarminProviderIdentity: hoisted.verifyLegacyIdentity,
  };
});
vi.mock('./health-flags', () => ({
  isGarminHealthSyncEnabled: vi.fn(() => true),
}));

import { GarminHealthPermissionError } from './health-sync';
import { GarminHealthAccountValidationError } from './health-lifecycle';
import { isGarminHealthSyncEnabled } from './health-flags';
import { processGarminHealthBackfillQueueItem } from './health-backfill';
import { countGarminHealthBackfillRequests } from './health-backfill-range';

function createQueueItem(): SleepSyncQueueItemInterface {
  return {
    id: 'backfill-1',
    ref: queueRef as never,
    type: 'garmin_health_backfill',
    provider: 'GarminAPI',
    userID: 'user-1',
    providerUserId: 'garmin-user-1',
    rangeStartMs: 0,
    rangeEndMs: 0,
    healthTrigger: 'backfill',
    garminHealthTokenCredentialGeneration: 'token-generation-1',
    garminHealthRootOAuthCredentialGeneration: 'root-generation-1',
    garminHealthConnectionStateGeneration: 'connection-generation-1',
    garminHealthBackfillSummaryIndex: 0,
    garminHealthBackfillNextStartMs: 0,
    garminHealthBackfillWindowsCompleted: 0,
    garminHealthBackfillWindowsTotal: 10,
    dateCreated: 1,
    queueRevision: 'revision-1',
    processed: false,
    retryCount: 0,
    dispatchedToCloudTask: 1,
  };
}

function seedRangeQueueItem(rangeStartMs: number, rangeEndMs: number, overrides = {}): SleepSyncQueueItemInterface {
  const queueItem = {
    ...createQueueItem(),
    rangeStartMs,
    rangeEndMs,
    garminHealthBackfillNextStartMs: rangeStartMs,
    garminHealthBackfillWindowsTotal: countGarminHealthBackfillRequests(rangeStartMs, rangeEndMs),
    ...overrides,
  };
  hoisted.queueData = { ...queueItem };
  hoisted.sleepStateData = {
    provider: 'GarminAPI',
    healthBackfillStatus: 'running',
    healthBackfillWindowsTotal: queueItem.garminHealthBackfillWindowsTotal,
    lastBackfillQueuedAtMs: rangeEndMs,
    lastBackfillEndMs: rangeEndMs,
  };
  return queueItem;
}

describe('Garmin Health backfill processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    hoisted.transactionSet.mockReset();
    tokenRef.get.mockReset().mockResolvedValue({ exists: true, data: () => tokenData });
    hoisted.getDeletionGuard.mockResolvedValue({ shouldSkip: false });
    hoisted.getDeletionGuardInTransaction.mockResolvedValue({ shouldSkip: false });
    hoisted.captureGuards.mockResolvedValue(guards);
    hoisted.refreshGuards.mockResolvedValue({ tokenData, tokenSnapshot, lifecycleGuards: guards });
    hoisted.guardsContinuous.mockReturnValue(true);
    hoisted.tokenMatchesGuard.mockReturnValue(true);
    hoisted.requestGet.mockResolvedValue('');
    hoisted.markSkipped.mockResolvedValue(QueueResult.Processed);
    hoisted.moveDlq.mockResolvedValue(QueueResult.MovedToDLQ);
    hoisted.moveLegacyDlq.mockResolvedValue(QueueResult.MovedToDLQ);
    hoisted.increaseRetry.mockResolvedValue(QueueResult.RetryIncremented);
    hoisted.updateSleepState.mockResolvedValue(true);
    hoisted.updateHealthState.mockResolvedValue(true);
    hoisted.queueData = { ...createQueueItem() };
    hoisted.sleepStateData = {
      provider: 'GarminAPI',
      healthBackfillStatus: 'running',
      healthBackfillWindowsTotal: 10,
      lastBackfillQueuedAtMs: 0,
      lastBackfillEndMs: 0,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([false, true])('finishes all families despite a moving cutoff (resuming: %s)', async (resuming) => {
    const nowMs = Date.parse('2026-04-30T12:00:00Z');
    const startMs = Date.parse('2016-01-01T00:00:00Z');
    const initialMinimumMs = nowMs - 30 * 24 * 60 * 60 * 1_000;
    vi.setSystemTime(nowMs);
    const total = countGarminHealthBackfillRequests(startMs, nowMs);
    const queueItem = seedRangeQueueItem(startMs, nowMs, resuming ? {
      garminHealthBackfillNextStartMs: initialMinimumMs,
      garminHealthBackfillWindowsCompleted: total / 10 - 1,
    } : {});
    hoisted.transactionSet.mockImplementation(() => vi.setSystemTime(Date.now() + 3_000));
    const requestsPerFamily = new Map<string, number>();
    hoisted.requestGet.mockImplementation(async ({ url }: { url: string }) => {
      vi.setSystemTime(Date.now() + 4_000);
      const request = new URL(url);
      const count = (requestsPerFamily.get(request.pathname) || 0) + 1;
      requestsPerFamily.set(request.pathname, count);
      // Bound the regression fixture even when the old worker loops indefinitely.
      if (count > 3) throw { statusCode: 503 };
      const minimumStartMs = initialMinimumMs + Date.now() - nowMs;
      const requestedStartMs = Number(request.searchParams.get('summaryStartTimeInSeconds')) * 1_000;
      if (requestedStartMs < minimumStartMs) {
        throw {
          statusCode: 400,
          error: { minStartTimeInSeconds: minimumStartMs / 1_000, errorMessage: 'secret provider body' },
        };
      }
      return '';
    });

    const processing = processGarminHealthBackfillQueueItem(queueItem);
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.Processed);
    expect([...requestsPerFamily.values()]).toEqual(Array(10).fill(2));
    expect(hoisted.queueData).toMatchObject({
      processed: true,
      garminHealthBackfillSummaryIndex: 10,
      garminHealthBackfillWindowsCompleted: total,
    });
    expect(hoisted.increaseRetry).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('[GarminHealthBackfill] Provider minimum adjusted.', expect.objectContaining({
      queueItemId: 'backfill-1', summaryType: 'dailies', recoveryAttempt: 1, statusCode: 400,
    }));
    expect(logger.info).toHaveBeenCalledWith('[GarminHealthBackfill] Backfill requests completed.', expect.objectContaining({
      windowsCompleted: total, windowsTotal: total,
    }));
    const logs = JSON.stringify([vi.mocked(logger.info).mock.calls, vi.mocked(logger.warn).mock.calls, vi.mocked(logger.error).mock.calls]);
    for (const sensitive of ['secret provider body', 'access-token', 'garmin-user-1', 'apis.garmin.com']) {
      expect(logs).not.toContain(sensitive);
    }
  });

  it('bounds minimum recovery and preserves the retry budget across task deliveries', async () => {
    const queueItem = seedRangeQueueItem(0, 24 * 60 * 60 * 1_000, { retryCount: 4 });
    hoisted.increaseRetry.mockImplementation(async () => {
      hoisted.queueData.retryCount = Number(hoisted.queueData.retryCount) + 1;
      return QueueResult.RetryIncremented;
    });
    for (const expectedRetryCount of [5, 6]) {
      hoisted.requestGet.mockReset().mockImplementation(async ({ url }: { url: string }) => {
        // The fallback also terminates the old unbounded implementation.
        if (hoisted.requestGet.mock.calls.length > 3) throw { statusCode: 503 };
        const startSeconds = Number(new URL(url).searchParams.get('summaryStartTimeInSeconds'));
        throw { statusCode: 400, error: { minStartTimeInSeconds: startSeconds + 1 } };
      });
      const processing = processGarminHealthBackfillQueueItem({ ...queueItem, ...hoisted.queueData });
      await vi.runAllTimersAsync();

      await expect(processing).resolves.toBe(QueueResult.RetryIncremented);
      expect(hoisted.requestGet).toHaveBeenCalledTimes(3);
      expect(hoisted.queueData).toMatchObject({
        retryCount: expectedRetryCount,
        processed: false,
        garminHealthBackfillWindowsCompleted: 0,
      });
      expect(hoisted.increaseRetry).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ statusCode: 400, message: 'Garmin Health backfill minimum-start recovery exhausted.' }),
        1, undefined, 'GARMIN_HEALTH_BACKFILL_RETRIES_EXHAUSTED', expect.any(Function),
      );
    }
    expect(logger.warn).toHaveBeenCalledWith('[GarminHealthBackfill] Minimum-start recovery limit reached.', expect.objectContaining({
      summaryType: 'dailies', recoveryAttempt: 3, result: QueueResult.RetryIncremented,
    }));
    expect(hoisted.moveDlq).not.toHaveBeenCalled();

    // Accepted windows still reset the normal transient retry budget.
    hoisted.requestGet.mockReset().mockResolvedValue('');
    const recovered = processGarminHealthBackfillQueueItem({ ...queueItem, ...hoisted.queueData });
    await vi.runAllTimersAsync();
    await expect(recovered).resolves.toBe(QueueResult.Processed);
    expect(hoisted.queueData).toMatchObject({ processed: true, retryCount: 0 });
  });

  it('skips unavailable families without treating each new family as a repeated cutoff failure', async () => {
    hoisted.requestGet.mockRejectedValue({ statusCode: 400, error: { minStartTimeInSeconds: 1 } });

    const processing = processGarminHealthBackfillQueueItem(createQueueItem());
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.Processed);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(10);
    expect(hoisted.increaseRetry).not.toHaveBeenCalled();
    expect(hoisted.queueData).toMatchObject({ processed: true, garminHealthBackfillWindowsCompleted: 10 });
  });

  it('reaches the existing failed-progress path when repeated cutoffs exhaust the durable retry budget', async () => {
    const queueItem = seedRangeQueueItem(0, 24 * 60 * 60 * 1_000, { retryCount: 9 });
    hoisted.requestGet.mockImplementation(async ({ url }: { url: string }) => {
      const startSeconds = Number(new URL(url).searchParams.get('summaryStartTimeInSeconds'));
      throw { statusCode: 400, error: { minStartTimeInSeconds: startSeconds + 1 } };
    });
    hoisted.increaseRetry.mockImplementationOnce(async (...args: unknown[]) => {
      expect(hoisted.queueData.retryCount).toBe(9);
      const onRetryExhausted = args[5] as (transaction: unknown, current: Record<string, unknown>) => Promise<void>;
      await onRetryExhausted({
        get: vi.fn(async () => ({ exists: true, data: () => ({ ...hoisted.sleepStateData }) })),
        set: (_ref: unknown, data: Record<string, unknown>, options: unknown) => hoisted.transactionSet(data, options),
      }, { ...hoisted.queueData });
      return QueueResult.MovedToDLQ;
    });

    const processing = processGarminHealthBackfillQueueItem(queueItem);
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.MovedToDLQ);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(3);
    expect(hoisted.transactionSet).toHaveBeenLastCalledWith(expect.objectContaining({
      healthBackfillStatus: 'failed',
      lastError: 'Garmin Health backfill exhausted automatic retries.',
    }), { merge: true });
    expect(logger.warn).toHaveBeenCalledWith('[GarminHealthBackfill] Minimum-start recovery limit reached.', expect.objectContaining({
      result: QueueResult.MovedToDLQ,
    }));
  });

  it.each(['deleted', 'superseded', 'disconnected'])('does not schedule a cutoff retry after the job is %s', async (reason) => {
    const queueItem = seedRangeQueueItem(0, 24 * 60 * 60 * 1_000);
    hoisted.requestGet.mockImplementation(async ({ url }: { url: string }) => {
      if (hoisted.requestGet.mock.calls.length === 3) {
        if (reason === 'deleted') hoisted.getDeletionGuardInTransaction.mockResolvedValueOnce({ shouldSkip: true });
        if (reason === 'superseded') hoisted.queueData.garminHealthBackfillNextStartMs = 500_000;
        if (reason === 'disconnected') metaRef.get.mockResolvedValueOnce({
          exists: true, data: () => ({ connectionStateGeneration: 'disconnected-generation' }),
        });
      }
      const startSeconds = Number(new URL(url).searchParams.get('summaryStartTimeInSeconds'));
      throw { statusCode: 400, error: { minStartTimeInSeconds: startSeconds + 1 } };
    });

    const processing = processGarminHealthBackfillQueueItem(queueItem);
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.Processed);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(3);
    expect(hoisted.increaseRetry).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith('[GarminHealthBackfill] Minimum-start recovery limit reached.', expect.anything());
  });

  it('requests every family through the documented endpoint aliases and completes durably', async () => {
    const processing = processGarminHealthBackfillQueueItem(createQueueItem());
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.Processed);
    expect(hoisted.requestGet.mock.calls.map(([options]) => options.url)).toEqual([
      'https://apis.garmin.com/wellness-api/rest/backfill/dailies?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/stressDetails?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/hrv?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/userMetrics?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/bodyComps?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/pulseOx?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/respiration?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/bloodPressures?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/skinTemp?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
      'https://apis.garmin.com/wellness-api/rest/backfill/healthSnapshot?summaryStartTimeInSeconds=0&summaryEndTimeInSeconds=0',
    ]);
    expect(hoisted.queueData).toEqual(expect.objectContaining({
      processed: true,
      resultStatus: 'success',
      garminHealthBackfillWindowsCompleted: 10,
      garminHealthBackfillSummaryIndex: 10,
    }));
    expect(hoisted.transactionSet).toHaveBeenLastCalledWith(expect.objectContaining({
      healthBackfillStatus: 'complete',
      healthBackfillWindowsCompleted: 10,
    }), { merge: true });
  });

  it('advances duplicate requests but retries a transient provider failure opaquely', async () => {
    hoisted.requestGet
      .mockRejectedValueOnce(Object.assign(new Error('duplicate body'), { statusCode: 409 }))
      .mockRejectedValueOnce(Object.assign(new Error('secret provider body'), { statusCode: 429 }));

    const processing = processGarminHealthBackfillQueueItem(createQueueItem());
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.RetryIncremented);
    expect(hoisted.queueData).toEqual(expect.objectContaining({
      garminHealthBackfillSummaryIndex: 1,
      garminHealthBackfillWindowsCompleted: 1,
    }));
    expect(hoisted.increaseRetry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Garmin Health backfill request failed.' }),
      1,
      undefined,
      'GARMIN_HEALTH_BACKFILL_RETRIES_EXHAUSTED',
      expect.any(Function),
    );
  });

  it('refreshes the fenced credential before every provider window', async () => {
    const refreshedTokenData = {
      ...tokenData,
      accessToken: 'refreshed-access-token',
    };
    const refreshedGuards = {
      ...guards,
      requiredExistingTokenCredential: {
        ...guards.requiredExistingTokenCredential,
        accessToken: 'refreshed-access-token',
      },
    };
    const refreshedTokenSnapshot = {
      exists: true,
      ref: tokenRef,
      data: () => refreshedTokenData,
    };
    tokenRef.get
      .mockResolvedValueOnce({ exists: true, data: () => tokenData })
      .mockResolvedValueOnce({ exists: true, data: () => tokenData })
      .mockResolvedValue({ exists: true, data: () => refreshedTokenData });
    hoisted.refreshGuards
      .mockResolvedValueOnce({ tokenData, tokenSnapshot, lifecycleGuards: guards })
      .mockResolvedValueOnce({ tokenData, tokenSnapshot, lifecycleGuards: guards })
      .mockResolvedValue({
        tokenData: refreshedTokenData,
        tokenSnapshot: refreshedTokenSnapshot,
        lifecycleGuards: refreshedGuards,
      });

    const processing = processGarminHealthBackfillQueueItem(createQueueItem());
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.Processed);
    expect(hoisted.refreshGuards).toHaveBeenCalledTimes(11);
    expect(hoisted.requestGet.mock.calls[0][0].headers).toEqual({
      Authorization: 'Bearer access-token',
    });
    expect(hoisted.requestGet.mock.calls[1][0].headers).toEqual({
      Authorization: 'Bearer refreshed-access-token',
    });
  });

  it('does not call Garmin after the queue cursor is superseded', async () => {
    hoisted.queueData = {
      ...createQueueItem(),
      garminHealthBackfillSummaryIndex: 1,
      garminHealthBackfillWindowsCompleted: 1,
    };

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.Processed);

    expect(hoisted.requestGet).not.toHaveBeenCalled();
  });

  it('moves an unprocessed terminal cursor to the DLQ instead of redispatching it forever', async () => {
    const queueItem = {
      ...createQueueItem(),
      garminHealthBackfillSummaryIndex: 10,
      garminHealthBackfillWindowsCompleted: 10,
    };
    hoisted.queueData = { ...queueItem };

    await expect(processGarminHealthBackfillQueueItem(queueItem))
      .resolves.toBe(QueueResult.MovedToDLQ);

    expect(hoisted.requestGet).not.toHaveBeenCalled();
    expect(hoisted.moveDlq).toHaveBeenCalledWith(expect.objectContaining({
      context: 'INVALID_GARMIN_HEALTH_BACKFILL_JOB',
    }));
  });

  it('stops before the next provider request when the Health rollback switch is disabled', async () => {
    vi.mocked(isGarminHealthSyncEnabled)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const processing = processGarminHealthBackfillQueueItem(createQueueItem());
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.Processed);
    expect(hoisted.requestGet).toHaveBeenCalledOnce();
    expect(hoisted.queueData).toEqual(expect.objectContaining({
      processed: true,
      resultStatus: 'skipped',
      skippedReason: 'provider_disabled',
      skippedContext: 'GARMIN_HEALTH_DISABLED',
    }));
    expect(hoisted.transactionSet).toHaveBeenLastCalledWith(expect.objectContaining({
      healthBackfillStatus: 'skipped',
      healthBackfillSummaryType: null,
    }), { merge: true });
    expect(hoisted.markSkipped).not.toHaveBeenCalled();
  });

  it('marks queued progress skipped when the Health rollback switch is disabled before processing', async () => {
    vi.mocked(isGarminHealthSyncEnabled).mockReturnValueOnce(false);

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.Processed);

    expect(hoisted.requestGet).not.toHaveBeenCalled();
    expect(hoisted.refreshGuards).not.toHaveBeenCalled();
    expect(hoisted.queueData).toEqual(expect.objectContaining({
      processed: true,
      resultStatus: 'skipped',
      skippedReason: 'provider_disabled',
      skippedContext: 'GARMIN_HEALTH_DISABLED',
    }));
    expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.objectContaining({
      healthBackfillStatus: 'skipped',
      healthBackfillSummaryType: null,
    }), { merge: true });
  });

  it('retries an opaque transient credential failure instead of skipping the cursor', async () => {
    hoisted.refreshGuards.mockRejectedValueOnce(new Error('secret refresh response'));

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.RetryIncremented);

    expect(hoisted.markSkipped).not.toHaveBeenCalled();
    expect(hoisted.increaseRetry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Garmin Health backfill request failed.' }),
      1,
      undefined,
      'GARMIN_HEALTH_BACKFILL_RETRIES_EXHAUSTED',
      expect.any(Function),
    );
    expect(JSON.stringify(hoisted.increaseRetry.mock.calls)).not.toContain('secret refresh response');
  });

  it('marks the matching backfill state failed when transient retries are exhausted', async () => {
    hoisted.requestGet.mockRejectedValueOnce(Object.assign(new Error('unavailable'), {
      statusCode: 503,
    }));
    hoisted.increaseRetry.mockImplementationOnce(async (...args: unknown[]) => {
      const onRetryExhausted = args[5] as (
        transaction: unknown,
        currentQueueItem: Record<string, unknown>,
      ) => Promise<void>;
      await onRetryExhausted({
        get: vi.fn(async () => ({
          exists: true,
          data: () => ({ ...hoisted.sleepStateData }),
        })),
        set: (_ref: unknown, data: Record<string, unknown>, options: unknown) => {
          hoisted.transactionSet(data, options);
        },
      }, { ...hoisted.queueData });
      return QueueResult.MovedToDLQ;
    });

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.MovedToDLQ);

    expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'GarminAPI',
      healthBackfillStatus: 'failed',
      healthBackfillSummaryType: null,
      lastError: 'Garmin Health backfill exhausted automatic retries.',
    }), { merge: true });
  });

  it('does not fail progress owned by a newer backfill when stale retries are exhausted', async () => {
    hoisted.sleepStateData.lastBackfillQueuedAtMs = 1_000;
    hoisted.requestGet.mockRejectedValueOnce(Object.assign(new Error('unavailable'), {
      statusCode: 503,
    }));
    hoisted.increaseRetry.mockImplementationOnce(async (...args: unknown[]) => {
      const onRetryExhausted = args[5] as (
        transaction: unknown,
        currentQueueItem: Record<string, unknown>,
      ) => Promise<void>;
      await onRetryExhausted({
        get: vi.fn(async () => ({
          exists: true,
          data: () => ({ ...hoisted.sleepStateData }),
        })),
        set: (_ref: unknown, data: Record<string, unknown>, options: unknown) => {
          hoisted.transactionSet(data, options);
        },
      }, { ...hoisted.queueData });
      return QueueResult.MovedToDLQ;
    });

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.MovedToDLQ);

    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('records reconnect-required when preflight account verification returns unauthorized', async () => {
    hoisted.refreshGuards.mockRejectedValueOnce(Object.assign(new Error('provider body'), {
      statusCode: 401,
    }));

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.MovedToDLQ);

    expect(hoisted.updateHealthState).toHaveBeenCalledWith(
      'user-1',
      'GarminAPI',
      expect.objectContaining({ status: 'reconnect_required' }),
      expect.any(Number),
      guards,
    );
    expect(hoisted.increaseRetry).not.toHaveBeenCalled();
  });

  it('skips a verified Garmin account lifecycle mismatch', async () => {
    hoisted.refreshGuards.mockRejectedValueOnce(new GarminHealthAccountValidationError());

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.Processed);

    expect(hoisted.queueData).toEqual(expect.objectContaining({
      processed: true,
      resultStatus: 'skipped',
      skippedReason: 'user_or_provider_lifecycle_changed',
    }));
    expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.objectContaining({
      healthBackfillStatus: 'skipped',
      healthBackfillSummaryType: null,
    }), { merge: true });
    expect(hoisted.increaseRetry).not.toHaveBeenCalled();
  });

  it('does not overwrite progress owned by a newer Garmin backfill', async () => {
    hoisted.sleepStateData.lastBackfillQueuedAtMs = 1_000;
    hoisted.refreshGuards.mockRejectedValueOnce(new GarminHealthAccountValidationError());

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.Processed);

    expect(hoisted.queueData).toEqual(expect.objectContaining({
      processed: true,
      resultStatus: 'skipped',
    }));
    expect(hoisted.transactionSet).not.toHaveBeenCalled();
  });

  it('uses the refreshed credential guard when recording missing Health permission', async () => {
    const refreshedGuards = {
      ...guards,
      requiredExistingTokenCredential: {
        ...guards.requiredExistingTokenCredential,
        accessToken: 'refreshed-access-token',
      },
    };
    hoisted.refreshGuards.mockResolvedValueOnce({
      tokenData,
      tokenSnapshot,
      lifecycleGuards: refreshedGuards,
    });
    hoisted.assertPermission.mockImplementationOnce(() => {
      throw new GarminHealthPermissionError('user-1');
    });

    await expect(processGarminHealthBackfillQueueItem(createQueueItem()))
      .resolves.toBe(QueueResult.MovedToDLQ);

    expect(hoisted.updateHealthState).toHaveBeenCalledWith(
      'user-1',
      'GarminAPI',
      expect.objectContaining({ status: 'permission_missing' }),
      expect.any(Number),
      refreshedGuards,
    );
  });

  it('rejects a repeated minimum that is already behind the durable cursor', async () => {
    const queueItem = {
      ...createQueueItem(),
      rangeEndMs: 1_000,
      garminHealthBackfillNextStartMs: 1_000,
    };
    hoisted.queueData = { ...queueItem };
    hoisted.sleepStateData.lastBackfillQueuedAtMs = 1_000;
    hoisted.sleepStateData.lastBackfillEndMs = 1_000;
    hoisted.requestGet.mockRejectedValueOnce({
      statusCode: 400,
      error: { minStartTimeInSeconds: 0 },
    });

    await expect(processGarminHealthBackfillQueueItem(queueItem))
      .resolves.toBe(QueueResult.MovedToDLQ);

    expect(hoisted.moveDlq).toHaveBeenCalledWith(expect.objectContaining({
      queueItem: expect.objectContaining({ id: 'backfill-1' }),
      error: expect.objectContaining({ message: 'Garmin Health backfill request failed.' }),
      context: 'GARMIN_HEALTH_BACKFILL_INVALID_RANGE',
      userID: 'user-1',
      phase: 'garmin_health_backfill_dlq:GARMIN_HEALTH_BACKFILL_INVALID_RANGE',
      logPrefix: 'GarminHealthBackfill',
      isCurrent: expect.any(Function),
      onBeforeMoveInTransaction: expect.any(Function),
    }));
    const dlqParams = hoisted.moveDlq.mock.calls[0][0] as {
      onBeforeMoveInTransaction: (
        transaction: unknown,
        currentQueueItem: Record<string, unknown>,
      ) => Promise<void>;
    };
    await dlqParams.onBeforeMoveInTransaction({
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ ...hoisted.sleepStateData }),
      })),
      set: (_ref: unknown, data: Record<string, unknown>, options: unknown) => {
        hoisted.transactionSet(data, options);
      },
    }, { ...hoisted.queueData });
    expect(hoisted.transactionSet).toHaveBeenCalledWith(expect.objectContaining({
      healthBackfillStatus: 'failed',
      healthBackfillSummaryType: null,
      lastError: 'Garmin Health backfill ended because the provider request was invalid.',
    }), { merge: true });
  });
});
