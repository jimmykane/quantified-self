import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';

const hoisted = vi.hoisted(() => ({
  getTokenData: vi.fn(),
  requestGet: vi.fn(),
  mapGarminHealthSummaries: vi.fn(),
  captureGuards: vi.fn(),
  guardsContinuous: vi.fn(),
  tokenMatchesGuard: vi.fn(),
}));

vi.mock('../tokens', () => ({
  getTokenData: hoisted.getTokenData,
}));

vi.mock('../request-helper', () => ({
  get: hoisted.requestGet,
}));

vi.mock('./health', async importOriginal => ({
  ...(await importOriginal<typeof import('./health')>()),
  mapGarminHealthSummaries: hoisted.mapGarminHealthSummaries,
}));

vi.mock('./health-lifecycle', () => ({
  captureActiveGarminHealthWriteLifecycleGuards: hoisted.captureGuards,
  areGarminHealthWriteLifecycleGuardsContinuous: hoisted.guardsContinuous,
  doesGarminHealthTokenDataMatchGuard: hoisted.tokenMatchesGuard,
  GarminHealthAccountValidationError: class GarminHealthAccountValidationError extends Error {
    readonly name = 'GarminHealthAccountValidationError';
    readonly code = 'garmin_health_account_invalid';
  },
}));

import {
  GARMIN_HEALTH_MAX_RESPONSE_BYTES,
  GARMIN_HEALTH_REQUEST_TIMEOUT_MS,
  GarminHealthPermissionError,
  processGarminHealthQueueItem,
} from './health-sync';
import { GarminHealthAccountValidationError } from './health-lifecycle';

function lifecycleGuards(providerIdentityPinned = true) {
  return {
    requiredExistingDocumentRef: { path: 'garmin-token' },
    requiredExistingTokenCredential: {
      accessToken: 'garmin-access-token',
      refreshToken: 'garmin-refresh-token',
      credentialGeneration: 'token-generation-1',
    },
    providerUserId: 'garmin-user-1',
    providerIdentityPinned,
    tokenCredentialGeneration: 'token-generation-1',
    rootOAuthCredentialGeneration: 'root-generation-1',
    connectionStateGeneration: 'connection-generation-1',
  };
}

function tokenSnapshot(): admin.firestore.DocumentSnapshot {
  const get = vi.fn();
  const snapshot = {
    id: 'garmin-token-1',
    exists: true,
    data: () => ({
      serviceName: 'GarminAPI',
      userID: 'garmin-user-1',
      accessToken: 'garmin-access-token',
    }),
    ref: {
      get,
    },
  } as unknown as admin.firestore.DocumentSnapshot;
  get.mockResolvedValue(snapshot);
  return snapshot;
}

function queueItem() {
  return {
    id: 'garmin-health-queue-item',
    dateCreated: 1_700_000_000_000,
    processed: false,
    retryCount: 0,
    type: 'garmin_ping' as const,
    provider: 'GarminAPI' as const,
    userID: 'test-user',
    providerUserId: 'garmin-user-1',
    garminSummaryType: 'dailies' as const,
    callbackURL: 'https://apis.garmin.com/wellness-api/rest/dailies?uploadStartTimeInSeconds=1777424400&uploadEndTimeInSeconds=1777424460&token=garmin-pull-token',
  };
}

describe('Garmin Health callback synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getTokenData.mockResolvedValue({
      accessToken: 'garmin-access-token',
      refreshToken: 'garmin-refresh-token',
      permissions: ['HEALTH_EXPORT'],
    });
    hoisted.captureGuards.mockResolvedValue(lifecycleGuards());
    hoisted.guardsContinuous.mockReturnValue(true);
    hoisted.tokenMatchesGuard.mockReturnValue(true);
    hoisted.requestGet.mockResolvedValue([{ summaryId: 'summary-1' }]);
    hoisted.mapGarminHealthSummaries.mockReturnValue([]);
  });

  it('bounds the authenticated callback and uses upload end as the revision order', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T06:00:00.000Z'));
    try {
      const initialGuards = lifecycleGuards();
      const result = await processGarminHealthQueueItem(
        queueItem(),
        tokenSnapshot(),
        'test-user',
        initialGuards,
      );

      expect(hoisted.getTokenData).toHaveBeenCalledWith(
        expect.anything(),
        'garminAPI',
        false,
        {
          opaqueTelemetry: true,
          expectedActiveOAuthCredentialGeneration: 'root-generation-1',
        },
      );
      expect(hoisted.requestGet).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer garmin-access-token' },
        json: true,
        maxResponseBytes: GARMIN_HEALTH_MAX_RESPONSE_BYTES,
        timeout: GARMIN_HEALTH_REQUEST_TIMEOUT_MS,
        url: queueItem().callbackURL,
      });
      expect(hoisted.mapGarminHealthSummaries).toHaveBeenCalledWith(
        'dailies',
        [{ summaryId: 'summary-1' }],
        'garmin-user-1',
        1_777_424_460_000,
        Date.now(),
      );
      expect(result.lifecycleGuards).toMatchObject({
        connectionStateGeneration: 'connection-generation-1',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('provider-verifies legacy account identity before following its callback', async () => {
    hoisted.captureGuards.mockResolvedValue(lifecycleGuards(false));
    hoisted.requestGet
      .mockResolvedValueOnce({ userId: 'garmin-user-1' })
      .mockResolvedValueOnce([]);

    await processGarminHealthQueueItem(
      queueItem(),
      tokenSnapshot(),
      'test-user',
      lifecycleGuards(false),
    );

    expect(hoisted.requestGet).toHaveBeenNthCalledWith(1, {
      headers: { Authorization: 'Bearer garmin-access-token' },
      json: true,
      maxResponseBytes: 16 * 1024,
      timeout: GARMIN_HEALTH_REQUEST_TIMEOUT_MS,
      url: 'https://apis.garmin.com/wellness-api/rest/user/id',
    });
    expect(hoisted.requestGet).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: queueItem().callbackURL,
    }));
  });

  it('rejects a legacy identity mismatch before requesting callback data', async () => {
    hoisted.captureGuards.mockResolvedValue(lifecycleGuards(false));
    hoisted.requestGet.mockResolvedValueOnce({ userId: 'replacement-account' });

    await expect(processGarminHealthQueueItem(
      queueItem(),
      tokenSnapshot(),
      'test-user',
      lifecycleGuards(false),
    )).rejects.toBeInstanceOf(GarminHealthAccountValidationError);
    expect(hoisted.requestGet).toHaveBeenCalledTimes(1);
  });

  it('maps Garmin 412 callback responses to a non-retryable permission state', async () => {
    hoisted.requestGet.mockRejectedValueOnce(Object.assign(new Error('provider body'), {
      statusCode: 412,
    }));

    await expect(processGarminHealthQueueItem(
      queueItem(),
      tokenSnapshot(),
      'test-user',
      lifecycleGuards(),
    )).rejects.toBeInstanceOf(GarminHealthPermissionError);
  });

  it('rejects a lifecycle change observed after provider I/O', async () => {
    hoisted.guardsContinuous.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await expect(processGarminHealthQueueItem(
      queueItem(),
      tokenSnapshot(),
      'test-user',
      lifecycleGuards(),
    )).rejects.toBeInstanceOf(GarminHealthAccountValidationError);
  });
});
