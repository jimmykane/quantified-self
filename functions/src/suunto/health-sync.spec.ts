import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type * as admin from 'firebase-admin';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { getTokenCredentialSnapshot } from '../token-refresh-coordinator';

const hoisted = vi.hoisted(() => ({
  requestGet: vi.fn(),
  getTokenData: vi.fn(),
  getServiceConnectionMeta: vi.fn(),
  shouldSkipQueueWorkForDeletedUser: vi.fn(),
  tokenGet: vi.fn(),
  tokenData: {} as Record<string, unknown>,
  metaRef: { path: 'users/staged-user/meta/suuntoApp' },
  tokenRootRef: { path: 'suuntoAppAccessTokens/staged-user' },
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          doc: vi.fn(() => hoisted.metaRef),
        })),
      })),
    })),
  }),
}));

vi.mock('../config', () => ({
  config: { suuntoapp: { subscription_key: 'test-subscription-key' } },
}));

vi.mock('../request-helper', () => ({
  get: hoisted.requestGet,
}));

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: hoisted.getServiceConnectionMeta,
}));

vi.mock('../service-token-store', () => ({
  getServiceTokenRootDocumentRef: vi.fn(() => hoisted.tokenRootRef),
}));

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: hoisted.shouldSkipQueueWorkForDeletedUser,
}));

vi.mock('../tokens', () => ({
  getTokenData: hoisted.getTokenData,
  TokenRefreshSkippedForDeletedUserError: class TokenRefreshSkippedForDeletedUserError extends Error {
    readonly name = 'TokenRefreshSkippedForDeletedUserError';

    constructor(
      public readonly firebaseUserID: string,
      public readonly serviceName: ServiceNames,
      public readonly tokenDocumentID: string,
      public readonly phase: string,
    ) {
      super('Token refresh skipped for deleted user.');
    }
  },
}));

import {
  captureSuuntoHealthWriteLifecycleGuards,
  processSuuntoHealthQueueItem,
  suuntoHealthSyncTestInternals,
  SuuntoHealthRequestError,
} from './health-sync';

const START_MS = Date.parse('2026-08-26T00:00:00.000Z');
const END_MS = Date.parse('2026-08-27T00:00:00.000Z');

function tokenProjection(accessToken: string): Record<string, unknown> {
  return {
    accessToken,
    refreshToken: 'refresh-token',
    expiresAt: Date.parse('2026-09-01T00:00:00.000Z'),
    dateCreated: 1_000,
    dateRefreshed: accessToken === 'refreshed-access-token' ? 2_000 : 1_000,
    tokenCredentialGeneration: 'credential-generation-1',
    userName: 'suunto-account-1',
  };
}

function tokenSnapshot(): admin.firestore.DocumentSnapshot {
  return {
    id: 'suunto-account-1',
    exists: true,
    data: () => hoisted.tokenData,
    ref: {
      path: 'suuntoAppAccessTokens/staged-user/tokens/suunto-account-1',
      parent: { parent: { id: 'staged-user' } },
      get: hoisted.tokenGet,
    },
  } as unknown as admin.firestore.DocumentSnapshot;
}

function queueItem(): SleepSyncQueueItemInterface {
  return {
    id: 'suunto-health-1',
    dateCreated: 1_700_000_000_000,
    processed: false,
    provider: 'SuuntoApp',
    providerUserId: 'suunto-account-1',
    retryCount: 0,
    type: 'suunto_health_poll',
    rangeStartMs: START_MS,
    rangeEndMs: END_MS,
  };
}

describe('Suunto Health provider sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.tokenData = tokenProjection('initial-access-token');
    hoisted.tokenGet.mockImplementation(async () => ({
      exists: true,
      data: () => hoisted.tokenData,
    }));
    hoisted.getTokenData.mockImplementation(async () => ({ ...hoisted.tokenData }));
    hoisted.getServiceConnectionMeta.mockResolvedValue({
      connectionState: 'connected',
      connectionStateGeneration: 'connection-generation-1',
    });
    hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
    hoisted.requestGet
      .mockResolvedValueOnce([{
        timestamp: '2026-08-26T12:00:00.000Z',
        entryData: { HR: 60 },
      }])
      .mockResolvedValueOnce([{
        Name: 'stepcount',
        Aggregation: 'sum',
        Sources: [{
          Name: 'private-watch-id',
          Samples: [{ TimeISO8601: '2026-08-26T00:00:00.000Z', Value: 1234 }],
        }],
      }])
      .mockResolvedValueOnce([{
        timestamp: '2026-08-26T12:05:00.000Z',
        entryData: { Balance: 0.75, StressState: 2 },
      }]);
  });

  it('fetches all three bounded feeds and returns separate source records', async () => {
    const snapshot = tokenSnapshot();
    const initialGuards = await captureSuuntoHealthWriteLifecycleGuards(
      'staged-user',
      snapshot.ref,
      getTokenCredentialSnapshot(hoisted.tokenData),
    );

    const result = await processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    );

    expect(result.healthResults.map(item => item.input.sourceRecordType)).toEqual([
      'suunto_247_activity',
      'suunto_247_daily_activity_statistics',
      'suunto_247_recovery',
    ]);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(3);
    const requestStartMs = START_MS - 24 * 60 * 60 * 1000;
    const requestEndMs = END_MS + 24 * 60 * 60 * 1000;
    expect(hoisted.requestGet.mock.calls.map(([options]) => options.url)).toEqual([
      `https://cloudapi.suunto.com/247samples/activity?from=${requestStartMs}&to=${requestEndMs - 1}`,
      `https://cloudapi.suunto.com/247samples/daily-activity-statistics?startdate=${encodeURIComponent(new Date(requestStartMs).toISOString())}&enddate=${encodeURIComponent(new Date(requestEndMs - 1).toISOString())}`,
      `https://cloudapi.suunto.com/247samples/recovery?from=${requestStartMs}&to=${requestEndMs - 1}`,
    ]);
    for (const [options] of hoisted.requestGet.mock.calls) {
      expect(options).toEqual(expect.objectContaining({
        maxResponseBytes: 4 * 1024 * 1024,
        timeout: 30_000,
      }));
      expect(options.headers.Authorization).toBe('Bearer initial-access-token');
    }
  });

  it('pads split requests without exceeding the provider 28-day limit', () => {
    const endMs = START_MS + 28 * 24 * 60 * 60 * 1000;
    const windows = suuntoHealthSyncTestInternals.buildSuuntoHealthRequestWindows(START_MS, endMs);

    expect(windows).toHaveLength(2);
    expect(windows[0].targetStartMs).toBe(START_MS);
    expect(windows[0].targetEndMs).toBe(windows[1].targetStartMs);
    expect(windows[1].targetEndMs).toBe(endMs);
    expect(windows.every(window => (
      window.requestEndMs - window.requestStartMs <= 28 * 24 * 60 * 60 * 1000
    ))).toBe(true);
  });

  it('retains a complete local-day record when the target starts mid-day', async () => {
    hoisted.requestGet.mockReset()
      .mockResolvedValueOnce([
        { timestamp: '2026-08-26T01:00:00.000Z', entryData: { HR: 50 } },
        { timestamp: '2026-08-26T13:00:00.000Z', entryData: { HR: 60 } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const snapshot = tokenSnapshot();
    const initialGuards = await captureSuuntoHealthWriteLifecycleGuards(
      'staged-user',
      snapshot.ref,
      getTokenCredentialSnapshot(hoisted.tokenData),
    );

    const result = await processSuuntoHealthQueueItem(
      {
        ...queueItem(),
        rangeStartMs: Date.parse('2026-08-26T12:00:00.000Z'),
        rangeEndMs: Date.parse('2026-08-27T12:00:00.000Z'),
      },
      snapshot,
      'staged-user',
      initialGuards,
    );

    expect(result.healthResults).toHaveLength(1);
    expect(result.healthResults[0].input.sampleSeries[0].nativeValues).toEqual([50, 60]);
  });

  it('force-refreshes once after a provider 401 and advances the write fence', async () => {
    hoisted.requestGet.mockReset()
      .mockRejectedValueOnce({ response: { statusCode: 401 }, body: 'private response' })
      .mockResolvedValueOnce([{
        timestamp: '2026-08-26T12:00:00.000Z',
        entryData: { HR: 60 },
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    hoisted.getTokenData.mockImplementation(async (
      _snapshot: admin.firestore.DocumentSnapshot,
      _serviceName: ServiceNames,
      forceRefresh = false,
    ) => {
      if (forceRefresh) hoisted.tokenData = tokenProjection('refreshed-access-token');
      return { ...hoisted.tokenData };
    });
    const snapshot = tokenSnapshot();
    const initialGuards = await captureSuuntoHealthWriteLifecycleGuards(
      'staged-user',
      snapshot.ref,
      getTokenCredentialSnapshot(hoisted.tokenData),
    );

    const result = await processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    );

    expect(result.healthResults).toHaveLength(1);
    expect(hoisted.getTokenData).toHaveBeenCalledWith(snapshot, ServiceNames.SuuntoApp, true, {
      opaqueTelemetry: true,
    });
    expect(hoisted.requestGet.mock.calls[1]?.[0]?.headers.Authorization)
      .toBe('Bearer refreshed-access-token');
    expect(result.lifecycleGuards.requiredExistingTokenCredential.accessToken)
      .toBe('refreshed-access-token');
  });

  it('replaces provider transport details with an opaque retry error', async () => {
    hoisted.requestGet.mockReset().mockRejectedValueOnce(Object.assign(
      new Error('private-provider-response private-access-token'),
      { statusCode: 503 },
    ));
    const snapshot = tokenSnapshot();
    const initialGuards = await captureSuuntoHealthWriteLifecycleGuards(
      'staged-user',
      snapshot.ref,
      getTokenCredentialSnapshot(hoisted.tokenData),
    );

    let caught: unknown;
    try {
      await processSuuntoHealthQueueItem(queueItem(), snapshot, 'staged-user', initialGuards);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SuuntoHealthRequestError);
    expect(caught).toEqual(expect.objectContaining({ message: 'Suunto Health request failed.' }));
    expect(JSON.stringify(caught)).not.toContain('private-provider-response');
    expect(JSON.stringify(caught)).not.toContain('private-access-token');
  });

  it('checks the deletion guard before every provider request', async () => {
    const snapshot = tokenSnapshot();
    const initialGuards = await captureSuuntoHealthWriteLifecycleGuards(
      'staged-user',
      snapshot.ref,
      getTokenCredentialSnapshot(hoisted.tokenData),
    );
    hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValueOnce(true);

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toMatchObject({ name: 'TokenRefreshSkippedForDeletedUserError' });
    expect(hoisted.requestGet).not.toHaveBeenCalled();
  });

  it('stops before the next feed when deletion starts between provider requests', async () => {
    hoisted.requestGet.mockReset().mockResolvedValueOnce([{
      timestamp: '2026-08-26T12:00:00.000Z',
      entryData: { HR: 60 },
    }]);
    hoisted.shouldSkipQueueWorkForDeletedUser.mockReset()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const snapshot = tokenSnapshot();
    const initialGuards = await captureSuuntoHealthWriteLifecycleGuards(
      'staged-user',
      snapshot.ref,
      getTokenCredentialSnapshot(hoisted.tokenData),
    );

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toMatchObject({ name: 'TokenRefreshSkippedForDeletedUserError' });
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });

  it('stops before the next feed when the connection generation changes', async () => {
    hoisted.requestGet.mockReset().mockImplementationOnce(async () => {
      hoisted.getServiceConnectionMeta.mockResolvedValue({
        connectionState: 'connected',
        connectionStateGeneration: 'connection-generation-2',
      });
      return [{
        timestamp: '2026-08-26T12:00:00.000Z',
        entryData: { HR: 60 },
      }];
    });
    const snapshot = tokenSnapshot();
    const initialGuards = await captureSuuntoHealthWriteLifecycleGuards(
      'staged-user',
      snapshot.ref,
      getTokenCredentialSnapshot(hoisted.tokenData),
    );

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toMatchObject({ name: 'SuuntoHealthAccountValidationError' });
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });
});
