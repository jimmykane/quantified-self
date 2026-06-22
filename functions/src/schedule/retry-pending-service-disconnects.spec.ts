import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  cleanupServiceConnectionForUser: vi.fn(),
  getTokenData: vi.fn(),
  clearServiceDisconnectPending: vi.fn(),
  recordServiceDisconnectRetryFailure: vi.fn(),
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: any, handler: any) => handler,
}));

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: hoisted.collection,
    doc: hoisted.doc,
  }), {
    Timestamp: {
      now: vi.fn(() => ({ toMillis: () => 1_000 })),
      fromMillis: vi.fn((value: number) => ({ toMillis: () => value })),
    },
  });

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('../tokens', () => ({
  getTokenData: hoisted.getTokenData,
}));

vi.mock('../service-auth-lifecycle', () => ({
  cleanupServiceConnectionForUser: hoisted.cleanupServiceConnectionForUser,
  SERVICE_AUTH_CLEANUP_REASONS: {
    SubscriptionEnforcement: 'subscription_enforcement',
  },
}));

vi.mock('../service-disconnect-pending', () => ({
  clearServiceDisconnectPending: hoisted.clearServiceDisconnectPending,
  isServiceDisconnectPendingData: (data: any) => data?.disconnectState === 'disconnect_pending',
  PENDING_SERVICE_DISCONNECT_BATCH_LIMIT: 50,
  recordServiceDisconnectRetryFailure: hoisted.recordServiceDisconnectRetryFailure,
}));

import { retryPendingServiceDisconnectsTestInternals } from './retry-pending-service-disconnects';

function mockEmptyGraceAndSubscription(): void {
  hoisted.doc.mockReturnValue({
    get: vi.fn().mockResolvedValue({ data: () => ({}) }),
  });
  hoisted.collection.mockReturnValue({
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  });
}

describe('retry-pending-service-disconnects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmptyGraceAndSubscription();
    hoisted.cleanupServiceConnectionForUser.mockResolvedValue({
      deletedTokenCount: 1,
      preservedTokenCount: 0,
      localCleanupStatus: 'completed',
      retryableDisconnectFailures: [],
    });
    hoisted.getTokenData.mockResolvedValue({ accessToken: 'pending-token' });
    hoisted.clearServiceDisconnectPending.mockResolvedValue(undefined);
    hoisted.recordServiceDisconnectRetryFailure.mockResolvedValue(undefined);
  });

  it('clears pending disconnect without deauth when entitlement is active again', async () => {
    hoisted.collection.mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ role: 'pro' }) }],
      }),
    });
    hoisted.doc.mockReturnValueOnce({
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
    });

    await retryPendingServiceDisconnectsTestInternals.retryPendingDisconnectRoot(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
      {
        id: 'user-1',
        data: () => ({ disconnectState: 'disconnect_pending' }),
      } as any,
    );

    expect(hoisted.clearServiceDisconnectPending).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp);
    expect(hoisted.cleanupServiceConnectionForUser).not.toHaveBeenCalled();
  });

  it('records retry failure when cleanup preserves a pending token again', async () => {
    const failure = { tokenID: 'token-1', statusCode: 504, errorMessage: 'gateway timeout' };
    hoisted.cleanupServiceConnectionForUser.mockResolvedValueOnce({
      deletedTokenCount: 0,
      preservedTokenCount: 1,
      localCleanupStatus: 'completed',
      retryableDisconnectFailures: [failure],
    });

    await retryPendingServiceDisconnectsTestInternals.retryPendingDisconnectRoot(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
      {
        id: 'user-1',
        data: () => ({ disconnectState: 'disconnect_pending' }),
      } as any,
    );

    expect(hoisted.recordServiceDisconnectRetryFailure).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      failure,
    );
  });

  it('records retry failure when local cleanup remains partial without a retryable partner failure', async () => {
    hoisted.cleanupServiceConnectionForUser.mockResolvedValueOnce({
      deletedTokenCount: 0,
      preservedTokenCount: 0,
      localCleanupStatus: 'partial',
      retryableDisconnectFailures: [],
    });

    await retryPendingServiceDisconnectsTestInternals.retryPendingDisconnectRoot(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
      {
        id: 'user-1',
        data: () => ({ disconnectState: 'disconnect_pending' }),
      } as any,
    );

    expect(hoisted.recordServiceDisconnectRetryFailure).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
      {
        tokenID: 'unknown',
        statusCode: null,
        errorMessage: expect.stringContaining('local cleanup remained partial'),
      },
    );
  });

  it('clears restored-entitlement pending roots even when they are not due for retry', async () => {
    const pendingRootQuery = {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: 'user-1',
            data: () => ({
              disconnectState: 'disconnect_pending',
              disconnectManualReviewRequired: true,
              disconnectNextAttemptAt: null,
            }),
          },
        ],
      }),
    };
    const activeSubscriptionQuery = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ role: 'pro' }) }],
      }),
    };
    hoisted.collection
      .mockReturnValueOnce(pendingRootQuery)
      .mockReturnValueOnce(activeSubscriptionQuery);
    hoisted.doc.mockReturnValueOnce({
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
    });

    const clearedCount = await retryPendingServiceDisconnectsTestInternals.clearPendingDisconnectsForRestoredEntitlements(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
    );

    expect(clearedCount).toBe(1);
    expect(pendingRootQuery.where).toHaveBeenCalledWith('disconnectState', '==', 'disconnect_pending');
    expect(pendingRootQuery.where).not.toHaveBeenCalledWith('disconnectNextAttemptAt', expect.anything(), expect.anything());
    expect(hoisted.clearServiceDisconnectPending).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp);
    expect(hoisted.cleanupServiceConnectionForUser).not.toHaveBeenCalled();
  });

  it('uses a token resolver that explicitly allows pending-disconnect token use', async () => {
    const tokenDoc = { id: 'token-1' };

    await retryPendingServiceDisconnectsTestInternals.retryPendingDisconnectRoot(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
      {
        id: 'user-1',
        data: () => ({ disconnectState: 'disconnect_pending' }),
      } as any,
    );

    const cleanupOptions = hoisted.cleanupServiceConnectionForUser.mock.calls[0][3];
    await cleanupOptions.tokenResolver(tokenDoc);

    expect(hoisted.getTokenData).toHaveBeenCalledWith(tokenDoc, ServiceNames.SuuntoApp, false, {
      recoverTerminalAuthFailure: false,
      allowDisconnectPendingTokenUse: true,
    });
  });
});
