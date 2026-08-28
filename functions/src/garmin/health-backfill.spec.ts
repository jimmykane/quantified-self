import { beforeEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('./health-rollout', () => ({
  isGarminHealthSyncEnabled: vi.fn(() => true),
  isGarminHealthSyncUserAllowed: vi.fn(() => true),
}));

import { GarminHealthPermissionError } from './health-sync';
import { GarminHealthAccountValidationError } from './health-lifecycle';
import { isGarminHealthSyncEnabled } from './health-rollout';
import { processGarminHealthBackfillQueueItem } from './health-backfill';

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

describe('Garmin Health backfill processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    );
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

  it('stops before the next provider request when the Health rollout is disabled', async () => {
    vi.mocked(isGarminHealthSyncEnabled)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const processing = processGarminHealthBackfillQueueItem(createQueueItem());
    await vi.runAllTimersAsync();

    await expect(processing).resolves.toBe(QueueResult.Processed);
    expect(hoisted.requestGet).toHaveBeenCalledOnce();
    expect(hoisted.markSkipped).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      'user_not_allowed',
      { skippedContext: 'GARMIN_HEALTH_ROLLOUT' },
    );
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
    );
    expect(JSON.stringify(hoisted.increaseRetry.mock.calls)).not.toContain('secret refresh response');
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

    expect(hoisted.markSkipped).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      'user_or_provider_lifecycle_changed',
      { skippedContext: 'USER_OR_PROVIDER_LIFECYCLE_GUARD' },
    );
    expect(hoisted.increaseRetry).not.toHaveBeenCalled();
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

    expect(hoisted.updateSleepState).toHaveBeenCalledWith(
      'user-1',
      'GarminAPI',
      expect.objectContaining({ healthBackfillStatus: 'failed' }),
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
    }));
  });
});
