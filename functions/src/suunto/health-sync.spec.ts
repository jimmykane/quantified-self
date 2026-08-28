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

vi.mock('../request-helper', () => ({
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
  processSuuntoHealthQueueItem,
  sanitizeSuuntoHealthErrorForTelemetry,
  suuntoHealthSyncTestInternals,
  SuuntoHealthRequestError,
} from './health-sync';
import { SuuntoHealthValidationError } from './health';
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

  it('replaces provider transport details with an opaque retry error', async () => {
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
    expect(caught).toEqual(expect.objectContaining({ message: 'Suunto Health request failed.' }));
    expect(JSON.stringify(caught)).not.toContain('private-provider-response');
    expect(JSON.stringify(caught)).not.toContain('private-access-token');
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
