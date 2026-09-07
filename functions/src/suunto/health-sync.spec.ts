import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import type * as admin from 'firebase-admin';
import type { SleepSyncQueueItemInterface } from '../queue/queue-item.interface';
import { getTokenCredentialSnapshot } from '../token-refresh-coordinator';

const hoisted = vi.hoisted(() => ({
  requestGet: vi.fn(),
  getTokenData: vi.fn(),
  shouldSkipQueueWorkForDeletedUser: vi.fn(),
  tokenGet: vi.fn(),
  tokenRootGet: vi.fn(),
  tokenData: {} as Record<string, unknown>,
  tokenRootData: {} as Record<string, unknown>,
  connectionStateGeneration: 'connection-generation-1',
  captureCurrentSuuntoWebhookWriteLifecycleGuards: vi.fn(),
  metaRef: { path: 'users/staged-user/meta/suuntoApp' },
  tokenRootRef: {
    path: 'suuntoAppAccessTokens/staged-user',
    get: (...args: unknown[]) => hoisted.tokenRootGet(...args),
  },
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

vi.mock('../request-helper', async importOriginal => ({
  ...await importOriginal<typeof import('../request-helper')>(),
  get: hoisted.requestGet,
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

vi.mock('./health-webhook-binding-lifecycle', async importOriginal => ({
  ...await importOriginal<typeof import('./health-webhook-binding-lifecycle')>(),
  captureCurrentSuuntoWebhookWriteLifecycleGuards:
    (...args: unknown[]) => hoisted.captureCurrentSuuntoWebhookWriteLifecycleGuards(...args),
}));

import {
  getSuuntoHealthRequestTelemetry,
  processSuuntoHealthQueueItem,
  sanitizeSuuntoHealthErrorForTelemetry,
  suuntoHealthSyncTestInternals,
  SuuntoHealthRequestError,
} from './health-sync';
import { SuuntoHealthValidationError, SuuntoHealthResponseLimitError } from './health';
import { ResponseBodyTooLargeError } from '../request-helper';
import type { SuuntoWebhookWriteLifecycleGuards } from './health-webhook-binding-lifecycle';

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
      id: 'suunto-account-1',
      path: 'suuntoAppAccessTokens/staged-user/tokens/suunto-account-1',
      parent: { parent: { id: 'staged-user' } },
      get: hoisted.tokenGet,
    },
  } as unknown as admin.firestore.DocumentSnapshot;
}

function currentAuthorityGuards(
  snapshot = tokenSnapshot(),
): SuuntoWebhookWriteLifecycleGuards {
  const credential = getTokenCredentialSnapshot(hoisted.tokenData);
  const ref = (path: string) => ({ path }) as admin.firestore.DocumentReference;
  return {
    requiredExistingDocumentRef: snapshot.ref,
    requiredExistingTokenCredential: credential,
    requiredDocumentFieldValues: {
      documentRef: ref('suuntoHealthWebhookAccountBindings/binding-1'),
      expectedFields: {
        schemaVersion: 3,
        authorizationSource: 'oauth_callback',
        userID: 'staged-user',
        providerAccountDigest: 'opaque-account-digest',
        tokenCredentialGeneration: credential.credentialGeneration,
      },
    },
    additionalRequiredDocumentFieldValues: [{
      documentRef: snapshot.ref,
      expectedFields: {
        userName: hoisted.tokenData.userName,
        serviceName: ServiceNames.SuuntoApp,
        tokenCredentialGeneration: hoisted.tokenData.tokenCredentialGeneration,
      },
    }, {
      documentRef: hoisted.tokenRootRef as admin.firestore.DocumentReference,
      expectedFields: {
        activeOAuthCredentialGeneration: hoisted.tokenRootData.activeOAuthCredentialGeneration,
        disconnectState: hoisted.tokenRootData.disconnectState,
        serviceDisconnectOperationGeneration:
          hoisted.tokenRootData.serviceDisconnectOperationGeneration,
      },
    }, {
      documentRef: hoisted.metaRef as admin.firestore.DocumentReference,
      expectedFields: {
        connectionState: 'connected',
        connectionStateGeneration: hoisted.connectionStateGeneration,
      },
    }],
  };
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
  it('reports only an allowlisted validation code without provider field detail', () => {
    const telemetryError = sanitizeSuuntoHealthErrorForTelemetry(
      new SuuntoHealthValidationError('activity[42].entryData.HR is outside the supported numeric range.'),
    );

    expect(telemetryError.message).toBe(
      'Suunto Health response validation failed [numeric_value_out_of_range].',
    );
    expect(telemetryError.message).not.toContain('activity[42]');
    expect(sanitizeSuuntoHealthErrorForTelemetry(
      new SuuntoHealthValidationError('private-provider-detail'),
    ).message).toBe('Suunto Health response validation failed [unclassified_validation].');
  });

  it('exposes only a validated HTTP status for a Suunto provider request error', () => {
    expect(getSuuntoHealthRequestTelemetry(new SuuntoHealthRequestError(429))).toEqual({
      errorName: 'SuuntoHealthRequestError',
      errorCode: 'suunto_health_request_failed',
      providerStatusCode: 429,
    });
    expect(getSuuntoHealthRequestTelemetry(new SuuntoHealthRequestError(700))).toEqual({
      errorName: 'SuuntoHealthRequestError',
      errorCode: 'suunto_health_request_failed',
    });
    expect(getSuuntoHealthRequestTelemetry(new Error('provider body must not be logged'))).toBeNull();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.tokenData = tokenProjection('initial-access-token');
    hoisted.tokenRootData = {
      // A Suunto user may retain multiple connected accounts. The root tracks
      // the latest OAuth lifecycle revision, which need not belong to this token.
      activeOAuthCredentialGeneration: 'credential-generation-2',
    };
    hoisted.connectionStateGeneration = 'connection-generation-1';
    hoisted.captureCurrentSuuntoWebhookWriteLifecycleGuards
      .mockImplementation(async () => currentAuthorityGuards());
    hoisted.tokenGet.mockImplementation(async () => ({
      exists: true,
      data: () => hoisted.tokenData,
    }));
    hoisted.tokenRootGet.mockImplementation(async () => ({
      exists: true,
      data: () => hoisted.tokenRootData,
    }));
    hoisted.getTokenData.mockImplementation(async () => ({ ...hoisted.tokenData }));
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
    const initialGuards = currentAuthorityGuards(snapshot);

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
    expect(result.lifecycleGuards.requiredExistingTokenCredential.credentialGeneration)
      .toBe('credential-generation-1');
    expect(result.lifecycleGuards.additionalRequiredDocumentFieldValues[1]?.expectedFields)
      .toEqual(expect.objectContaining({
        activeOAuthCredentialGeneration: 'credential-generation-2',
      }));
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
    const initialGuards = currentAuthorityGuards(snapshot);

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

  it.each([
    ['activity', 0, 'samples'], ['recovery', 0, 'samples'],
    ['activity', 2, 'samples'], ['recovery', -5, 'samples'],
    ['activity', 0, 'bytes'], ['recovery', 0, 'bytes'],
    ['activity', 2, 'bytes'], ['recovery', -5, 'bytes'],
  ] as const)('refetches dense %s ranges at offset %s limited by %s without losing full-day samples', async (feed, offset, limit) => {
    const dayMs = 86_400_000;
    hoisted.requestGet.mockReset().mockImplementation(async ({ url }: { url: string }) => {
      const request = new URL(url);
      if (!request.pathname.endsWith(`/${feed}`)) return [];
      const from = Number(request.searchParams.get('from'));
      const to = Number(request.searchParams.get('to'));
      if (limit === 'bytes' && to - from + 1 > 6 * dayMs) {
        throw new ResponseBodyTooLargeError(4 * 1024 * 1024, 4 * 1024 * 1024 + 1);
      }
      return Array.from({ length: Math.floor((to - from + 1) / 60_000) }, (_, index) => ({
        timestamp: new Date(from + index * 60_000 + offset * 3_600_000).toISOString()
          .replace('Z', `${offset < 0 ? '-' : '+'}${String(Math.abs(offset)).padStart(2, '0')}:00`),
        entryData: feed === 'activity' ? { HR: 60 } : { Balance: 0.5, StressState: 2 },
      }));
    });
    const snapshot = tokenSnapshot();
    const result = await processSuuntoHealthQueueItem(
      { ...queueItem(), rangeEndMs: START_MS + 7 * dayMs }, snapshot, 'staged-user',
      currentAuthorityGuards(snapshot),
    );
    expect(result.healthResults).toHaveLength(offset === 0 ? 7 : 8);
    for (const record of result.healthResults) {
      expect(record.input.sampleSeries[0].nativeValues).toHaveLength(1440);
      expect(record.input.endTimeMs - record.input.startTimeMs).toBe(dayMs);
    }
    const feedCalls = hoisted.requestGet.mock.calls.filter(([options]) =>
      new URL(options.url).pathname.endsWith(`/${feed}`));
    expect(feedCalls).toHaveLength(3); // rejected parent, then two bounded children
    expect(hoisted.requestGet).toHaveBeenCalledTimes(feed === 'activity' ? 7 : 9);
    for (const [options] of hoisted.requestGet.mock.calls) {
      expect(options.maxResponseBytes).toBe(4 * 1024 * 1024);
    }
  });

  it.each(['samples', 'bytes'])('narrows daily-statistic %s failures and retains both sides', async limit => {
    const dayMs = 86_400_000;
    hoisted.requestGet.mockReset().mockImplementation(async ({ url }: { url: string }) => {
      const request = new URL(url);
      if (!request.pathname.endsWith('/daily-activity-statistics')) return [];
      const start = Date.parse(request.searchParams.get('startdate')!);
      const end = Date.parse(request.searchParams.get('enddate')!);
      if (limit === 'bytes' && end - start > 6 * dayMs) {
        throw new ResponseBodyTooLargeError(4 * 1024 * 1024, 4 * 1024 * 1024 + 1);
      }
      const samples = end - start > 6 * dayMs ? Array(65).fill(null)
        : Array.from({ length: 9 }, (_, i) => ({
          TimeISO8601: new Date(START_MS + (i - 1) * dayMs).toISOString(), Value: i,
        }));
      return [{ Name: 'stepcount', Aggregation: 'sum', Sources: [{ Name: 'watch', Samples: samples }] }];
    });
    const snapshot = tokenSnapshot();
    const result = await processSuuntoHealthQueueItem(
      { ...queueItem(), rangeEndMs: START_MS + 7 * dayMs }, snapshot, 'staged-user',
      currentAuthorityGuards(snapshot),
    );
    expect(result.healthResults).toHaveLength(7);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(8);
  });

  it.each(['samples', 'bytes'])('fails closed at the minimum target instead of truncating an oversized %s response', async limit => {
    hoisted.requestGet.mockReset();
    if (limit === 'bytes') {
      hoisted.requestGet.mockRejectedValue(new ResponseBodyTooLargeError(4 * 1024 * 1024, 4 * 1024 * 1024 + 1));
    } else {
      hoisted.requestGet.mockResolvedValue(Array(10_001).fill(null));
    }
    const snapshot = tokenSnapshot();
    await expect(processSuuntoHealthQueueItem(
      { ...queueItem(), rangeEndMs: START_MS + 4 * 86_400_000 }, snapshot, 'staged-user',
      currentAuthorityGuards(snapshot),
    )).rejects.toBeInstanceOf(limit === 'bytes' ? SuuntoHealthRequestError : SuuntoHealthResponseLimitError);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(3); // 4d -> 2d -> 1d
  });

  it('does not split malformed values', async () => {
    hoisted.requestGet.mockReset().mockResolvedValue([{ timestamp: 'invalid', entryData: { HR: 60 } }]);
    const snapshot = tokenSnapshot();
    await expect(processSuuntoHealthQueueItem(
      { ...queueItem(), rangeEndMs: START_MS + 7 * 86_400_000 }, snapshot, 'staged-user',
      currentAuthorityGuards(snapshot),
    )).rejects.toBeInstanceOf(SuuntoHealthValidationError);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['deletion', 'samples'], ['reconnect', 'samples'],
    ['deletion', 'bytes'], ['reconnect', 'bytes'],
  ])('rechecks %s before an adaptive child request after a %s limit', async (change, limit) => {
    hoisted.requestGet.mockReset().mockImplementationOnce(async () => {
      if (change === 'deletion') hoisted.shouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);
      else hoisted.connectionStateGeneration = 'connection-generation-2';
      if (limit === 'bytes') throw new ResponseBodyTooLargeError(4 * 1024 * 1024, 4 * 1024 * 1024 + 1);
      return Array(10_001).fill(null);
    });
    const snapshot = tokenSnapshot();
    await expect(processSuuntoHealthQueueItem(
      { ...queueItem(), rangeEndMs: START_MS + 7 * 86_400_000 }, snapshot, 'staged-user',
      currentAuthorityGuards(snapshot),
    )).rejects.toMatchObject({ name: change === 'deletion'
      ? 'TokenRefreshSkippedForDeletedUserError' : 'SuuntoHealthAccountValidationError' });
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });

  it.each(['samples', 'bytes'])('bounds adaptive pull time after %s limits before making further requests', async limit => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    hoisted.requestGet.mockReset().mockImplementationOnce(async () => {
      clock.mockReturnValue(now + 4 * 60_000);
      if (limit === 'bytes') throw new ResponseBodyTooLargeError(4 * 1024 * 1024, 4 * 1024 * 1024 + 1);
      return Array(10_001).fill(null);
    });
    try {
      const snapshot = tokenSnapshot();
      await expect(processSuuntoHealthQueueItem(
        { ...queueItem(), rangeEndMs: START_MS + 7 * 86_400_000 }, snapshot, 'staged-user',
        currentAuthorityGuards(snapshot),
      )).rejects.toThrow('Suunto Health pull budget exceeded.');
      expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(['samples', 'bytes'])('limits the total adaptive HTTP attempts after %s limits without returning partial success', async limit => {
    hoisted.requestGet.mockReset().mockImplementation(async ({ url }: { url: string }) => {
      const request = new URL(url);
      if (!request.pathname.endsWith('/recovery')) return [];
      const span = Number(request.searchParams.get('to')) + 1 - Number(request.searchParams.get('from'));
      if (limit === 'bytes' && span > 4 * 86_400_000) {
        throw new ResponseBodyTooLargeError(4 * 1024 * 1024, 4 * 1024 * 1024 + 1);
      }
      return span > 4 * 86_400_000 ? Array(10_001).fill(null) : [];
    });
    const snapshot = tokenSnapshot();
    await expect(processSuuntoHealthQueueItem(
      { ...queueItem(), rangeEndMs: START_MS + 28 * 86_400_000 }, snapshot, 'staged-user',
      currentAuthorityGuards(snapshot),
    )).rejects.toThrow('Suunto Health pull budget exceeded.');
    expect(hoisted.requestGet).toHaveBeenCalledTimes(64);
  });

  it('fails closed when accumulated result bytes exceed the memory budget', async () => {
    const byteLength = vi.spyOn(Buffer, 'byteLength').mockReturnValue(17 * 1024 * 1024);
    try {
      const snapshot = tokenSnapshot();
      await expect(processSuuntoHealthQueueItem(
        queueItem(), snapshot, 'staged-user', currentAuthorityGuards(snapshot),
      )).rejects.toThrow('Suunto Health result budget exceeded.');
    } finally {
      byteLength.mockRestore();
    }
  });

  it('ignores a current-day statistic returned beyond an older requested range', async () => {
    hoisted.requestGet.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        Name: 'stepcount',
        Aggregation: 'sum',
        Sources: [{
          Name: 'private-watch-id',
          Samples: [
            { TimeISO8601: '2026-08-26T00:00:00.000Z', Value: 1234 },
            { TimeISO8601: '2026-08-29T00:00:00.000Z', Value: 2345 },
          ],
        }],
      }])
      .mockResolvedValueOnce([]);
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);

    const result = await processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    );

    expect(result.healthResults).toHaveLength(1);
    expect(result.healthResults[0].input.sourceRecordType)
      .toBe('suunto_247_daily_activity_statistics');
    expect(result.healthResults[0].input.calendarDate).toBe('2026-08-26');
  });

  it('still validates a statistic that will be discarded outside the target', async () => {
    hoisted.requestGet.mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        Name: 'stepcount',
        Aggregation: 'sum',
        Sources: [{
          Name: 'private-watch-id',
          Samples: [{ TimeISO8601: '2026-08-29T00:00:00.000Z', Value: 'invalid' }],
        }],
      }]);
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toBeInstanceOf(SuuntoHealthValidationError);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(2);
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
    const initialGuards = currentAuthorityGuards(snapshot);

    const result = await processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    );

    expect(result.healthResults).toHaveLength(1);
    expect(hoisted.getTokenData).toHaveBeenCalledWith(snapshot, ServiceNames.SuuntoApp, true, {
      opaqueTelemetry: true,
      expectedActiveOAuthCredentialGeneration: 'credential-generation-2',
    });
    expect(hoisted.requestGet.mock.calls[1]?.[0]?.headers.Authorization)
      .toBe('Bearer refreshed-access-token');
    expect(result.lifecycleGuards.requiredExistingTokenCredential.accessToken)
      .toBe('refreshed-access-token');
  });

  it('replaces provider transport details with an opaque retry error and retains its HTTP status', async () => {
    hoisted.requestGet.mockReset().mockRejectedValueOnce(Object.assign(
      new Error('private-provider-response private-access-token'),
      { statusCode: 503 },
    ));
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);

    let caught: unknown;
    try {
      await processSuuntoHealthQueueItem(queueItem(), snapshot, 'staged-user', initialGuards);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SuuntoHealthRequestError);
    expect(caught).toEqual(expect.objectContaining({
      message: 'Suunto Health request failed.',
      providerStatusCode: 503,
    }));
    expect(JSON.stringify(caught)).toContain('"providerStatusCode":503');
    expect(JSON.stringify(caught)).not.toContain('private-provider-response');
    expect(JSON.stringify(caught)).not.toContain('private-access-token');
  });

  it('does not expose an invalid provider status in retry telemetry', async () => {
    hoisted.requestGet.mockReset().mockRejectedValueOnce(Object.assign(
      new Error('private-provider-response'),
      { statusCode: 700 },
    ));
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toEqual(expect.objectContaining({
      message: 'Suunto Health request failed.',
      providerStatusCode: undefined,
    }));
  });

  it.each([false, true])('logs the response byte limit without leaking payloads after refresh=%s', async refresh => {
    const providerError = Object.assign(new ResponseBodyTooLargeError(4 * 1024 * 1024, 5 * 1024 * 1024), {
      body: 'private-health-data',
      url: 'https://example.invalid?token=private-token',
      headers: { Authorization: 'private-credential' },
    });
    hoisted.requestGet.mockReset();
    if (refresh) {
      hoisted.requestGet.mockRejectedValueOnce({ statusCode: 401 });
    }
    hoisted.requestGet.mockRejectedValueOnce(providerError);
    const snapshot = tokenSnapshot();
    let caught: unknown;
    try {
      await processSuuntoHealthQueueItem(queueItem(), snapshot, 'staged-user', currentAuthorityGuards(snapshot));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SuuntoHealthRequestError);
    expect(getSuuntoHealthRequestTelemetry(sanitizeSuuntoHealthErrorForTelemetry(caught))).toEqual({
      errorName: 'SuuntoHealthRequestError',
      errorCode: 'suunto_health_request_failed',
      failureCategory: 'response_byte_limit',
    });
    expect(JSON.stringify(caught)).not.toContain('private-');
    expect(hoisted.requestGet).toHaveBeenCalledTimes(refresh ? 2 : 1);
  });

  it('checks the deletion guard before every provider request', async () => {
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);
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
    const initialGuards = currentAuthorityGuards(snapshot);

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
      hoisted.connectionStateGeneration = 'connection-generation-2';
      return [{
        timestamp: '2026-08-26T12:00:00.000Z',
        entryData: { HR: 60 },
      }];
    });
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toMatchObject({ name: 'SuuntoHealthAccountValidationError' });
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });

  it('stops before the next feed when the active OAuth credential generation changes', async () => {
    hoisted.requestGet.mockReset().mockImplementationOnce(async () => {
      hoisted.tokenRootData = {
        activeOAuthCredentialGeneration: 'credential-generation-3',
      };
      return [{
        timestamp: '2026-08-26T12:00:00.000Z',
        entryData: { HR: 60 },
      }];
    });
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toMatchObject({ name: 'SuuntoHealthAccountValidationError' });
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });

  it('stops before the next feed when a disconnect operation starts', async () => {
    hoisted.requestGet.mockReset().mockImplementationOnce(async () => {
      hoisted.tokenRootData = {
        ...hoisted.tokenRootData,
        disconnectState: 'pending',
        serviceDisconnectOperationGeneration: 'disconnect-generation-1',
      };
      return [{
        timestamp: '2026-08-26T12:00:00.000Z',
        entryData: { HR: 60 },
      }];
    });
    const snapshot = tokenSnapshot();
    const initialGuards = currentAuthorityGuards(snapshot);

    await expect(processSuuntoHealthQueueItem(
      queueItem(),
      snapshot,
      'staged-user',
      initialGuards,
    )).rejects.toMatchObject({ name: 'SuuntoHealthAccountValidationError' });
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });
});
