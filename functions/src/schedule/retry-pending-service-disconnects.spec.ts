import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const hoisted = vi.hoisted(() => ({
  collection: vi.fn(),
  collectionGroup: vi.fn(),
  doc: vi.fn(),
  cleanupServiceConnectionForUser: vi.fn(),
  getTokenData: vi.fn(),
  clearServiceDisconnectPending: vi.fn(),
  recordServiceDisconnectRetryFailure: vi.fn(),
  retryWahooReconnectQueueRelease: vi.fn(),
  retryPendingServiceRouteRestore: vi.fn(),
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
  const firestore = () => ({
    collection: hoisted.collection,
    collectionGroup: hoisted.collectionGroup,
    doc: hoisted.doc,
  });

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldPath: {
    documentId: vi.fn(() => '__name__'),
  },
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => 1_000 })),
    fromMillis: vi.fn((value: number) => ({ toMillis: () => value })),
  },
}));

vi.mock('../tokens', () => ({
  getTokenData: hoisted.getTokenData,
}));

vi.mock('../service-auth-lifecycle', () => ({
  cleanupServiceConnectionForUser: hoisted.cleanupServiceConnectionForUser,
  SERVICE_AUTH_CLEANUP_REASONS: {
    SubscriptionEnforcement: 'subscription_enforcement',
  },
}));

vi.mock('../service-connection-meta', () => ({
  retryWahooReconnectQueueRelease: hoisted.retryWahooReconnectQueueRelease,
  retryPendingServiceRouteRestore: hoisted.retryPendingServiceRouteRestore,
}));

vi.mock('../service-disconnect-pending', () => ({
  clearServiceDisconnectPending: hoisted.clearServiceDisconnectPending,
  getServiceDisconnectLifecycleGuardFromRootData: (data: Record<string, unknown> | null | undefined) => ({
    disconnectGeneration: data?.disconnectState === 'disconnect_pending'
      ? `${data.disconnectGeneration || ''}`.trim() || null
      : null,
    oauthCredentialGeneration: `${data?.activeOAuthCredentialGeneration || ''}`.trim() || null,
    oauthFlowGeneration: `${data?.oauthFlowGeneration || ''}`.trim() || null,
    disconnectOperationGeneration: `${data?.disconnectOperationGeneration || ''}`.trim() || null,
  }),
  isServiceDisconnectPendingData: (data: any) => data?.disconnectState === 'disconnect_pending',
  PENDING_SERVICE_DISCONNECT_BATCH_LIMIT: 50,
  recordServiceDisconnectRetryFailure: hoisted.recordServiceDisconnectRetryFailure,
}));

import { retryPendingServiceDisconnectsTestInternals } from './retry-pending-service-disconnects';

function buildCursorRef(data?: Record<string, unknown>) {
  return {
    get: vi.fn().mockResolvedValue(data
      ? { exists: true, data: () => data }
      : { exists: false, data: () => undefined }),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function mockEmptyGraceAndSubscription(): void {
  const cursorRef = buildCursorRef();
  hoisted.doc.mockImplementation((path: string) => {
    if (path.startsWith('pendingServiceDisconnectRetryCursors/')) {
      return cursorRef;
    }

    return {
      get: vi.fn().mockResolvedValue({ data: () => ({}) }),
    };
  });
  hoisted.collection.mockReturnValue({
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    startAfter: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  });
}

function buildPagedQuery(pages: any[][]) {
  let pageIndex = 0;
  return {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    startAfter: vi.fn().mockReturnThis(),
    get: vi.fn().mockImplementation(async () => ({
      empty: pages[pageIndex]?.length === 0,
      docs: pages[pageIndex++] || [],
    })),
  };
}

function buildUserServiceMetaRef(userID: string, serviceName: ServiceNames | string) {
  return {
    path: `users/${userID}/meta/${serviceName}`,
    parent: {
      id: 'meta',
      parent: {
        id: userID,
        parent: { id: 'users' },
      },
    },
  };
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
    hoisted.retryWahooReconnectQueueRelease.mockResolvedValue(true);
    hoisted.retryPendingServiceRouteRestore.mockResolvedValue(true);
    hoisted.collectionGroup.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    });
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
      {
        ...failure,
        lifecycleGuard: {
          disconnectGeneration: null,
          oauthCredentialGeneration: null,
          oauthFlowGeneration: null,
          disconnectOperationGeneration: null,
        },
      },
    );
  });

  it('retries the current durable Wahoo reconnect-release page', async () => {
    hoisted.collectionGroup.mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: ServiceNames.WahooAPI,
            ref: buildUserServiceMetaRef('user-1', ServiceNames.WahooAPI),
          },
          {
            id: ServiceNames.WahooAPI,
            ref: buildUserServiceMetaRef('user-2', ServiceNames.WahooAPI),
          },
        ],
      }),
    });

    await expect(retryPendingServiceDisconnectsTestInternals.retryPendingWahooReconnectQueueReleases()).resolves.toBe(2);

    expect(hoisted.collectionGroup).toHaveBeenCalledWith('meta');
    expect(hoisted.retryWahooReconnectQueueRelease).toHaveBeenCalledWith('user-1');
    expect(hoisted.retryWahooReconnectQueueRelease).toHaveBeenCalledWith('user-2');
  });

  it('bounds and checkpoints lifecycle-repair pages', async () => {
    const docs = Array.from({ length: 25 }, (_, index) => ({
      id: ServiceNames.WahooAPI,
      ref: buildUserServiceMetaRef(`user-${index}`, ServiceNames.WahooAPI),
    }));
    const query = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs }),
    };
    const cursorRef = buildCursorRef();
    hoisted.collectionGroup.mockReturnValueOnce(query);
    hoisted.doc.mockImplementation((path: string) => (
      path === 'pendingServiceDisconnectRetryCursors/lifecycle_wahoo_reconnect_release'
        ? cursorRef
        : { path }
    ));

    const page = await retryPendingServiceDisconnectsTestInternals.getLifecycleRepairPage(
      'wahoo_reconnect_release',
      'wahooReconnectReleasePending',
    );
    expect(page).toHaveLength(25);
    expect(cursorRef.set).not.toHaveBeenCalled();

    await retryPendingServiceDisconnectsTestInternals.checkpointLifecycleRepairPage(
      'wahoo_reconnect_release',
      page,
    );

    expect(query.limit).toHaveBeenCalledWith(25);
    expect(query.get).toHaveBeenCalledTimes(1);
    expect(cursorRef.set).toHaveBeenCalledWith({
      documentPath: `users/user-24/meta/${ServiceNames.WahooAPI}`,
    }, { merge: true });
  });

  it('continues lifecycle repair after its durable document-path cursor', async () => {
    const cursorPath = `users/user-24/meta/${ServiceNames.WahooAPI}`;
    const cursorRef = buildCursorRef({ documentPath: cursorPath });
    const query = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [{
        id: ServiceNames.WahooAPI,
        ref: buildUserServiceMetaRef('user-25', ServiceNames.WahooAPI),
      }] }),
    };
    hoisted.collectionGroup.mockReturnValueOnce(query);
    hoisted.doc.mockImplementation((path: string) => (
      path === 'pendingServiceDisconnectRetryCursors/lifecycle_wahoo_reconnect_release'
        ? cursorRef
        : { path }
    ));

    const page = await retryPendingServiceDisconnectsTestInternals.getLifecycleRepairPage(
      'wahoo_reconnect_release',
      'wahooReconnectReleasePending',
    );
    await retryPendingServiceDisconnectsTestInternals.checkpointLifecycleRepairPage(
      'wahoo_reconnect_release',
      page,
    );

    expect(query.startAfter).toHaveBeenCalledWith({ path: cursorPath });
    expect(cursorRef.delete).toHaveBeenCalledTimes(1);
  });

  it('retries provider-neutral route restoration markers', async () => {
    hoisted.collectionGroup.mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: [
          {
            id: ServiceNames.SuuntoApp,
            ref: buildUserServiceMetaRef('user-1', ServiceNames.SuuntoApp),
          },
          {
            id: 'not-a-service',
            ref: buildUserServiceMetaRef('user-2', 'not-a-service'),
          },
        ],
      }),
    });

    await expect(retryPendingServiceDisconnectsTestInternals.retryPendingServiceRouteRestorations())
      .resolves.toBe(1);

    expect(hoisted.retryPendingServiceRouteRestore).toHaveBeenCalledWith(
      'user-1',
      ServiceNames.SuuntoApp,
    );
    expect(hoisted.retryPendingServiceRouteRestore).toHaveBeenCalledTimes(1);
  });

  it('ignores matching marker fields outside users/{uid}/meta/{service}', async () => {
    hoisted.collectionGroup.mockReturnValueOnce({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({
        docs: [{
          id: ServiceNames.WahooAPI,
          ref: {
            path: `other/user-1/meta/${ServiceNames.WahooAPI}`,
            parent: {
              id: 'meta',
              parent: {
                id: 'user-1',
                parent: { id: 'other' },
              },
            },
          },
        }],
      }),
    });

    await expect(retryPendingServiceDisconnectsTestInternals.retryPendingWahooReconnectQueueReleases())
      .resolves.toBe(0);

    expect(hoisted.retryWahooReconnectQueueRelease).not.toHaveBeenCalled();
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
        lifecycleGuard: {
          disconnectGeneration: null,
          oauthCredentialGeneration: null,
          oauthFlowGeneration: null,
          disconnectOperationGeneration: null,
        },
      },
    );
  });

  it('clears restored-entitlement pending roots even when they are not due for retry', async () => {
    const pendingRootQuery = {
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      startAfter: vi.fn().mockReturnThis(),
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

    const clearedCount = await retryPendingServiceDisconnectsTestInternals.clearPendingDisconnectsForRestoredEntitlements(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
    );

    expect(clearedCount).toBe(1);
    expect(pendingRootQuery.where).toHaveBeenCalledWith('disconnectState', '==', 'disconnect_pending');
    expect(pendingRootQuery.where).not.toHaveBeenCalledWith('disconnectNextAttemptAt', expect.anything(), expect.anything());
    expect(hoisted.clearServiceDisconnectPending).toHaveBeenCalledWith('user-1', ServiceNames.SuuntoApp);
    expect(hoisted.cleanupServiceConnectionForUser).not.toHaveBeenCalled();
  });

  it('bounds restored-entitlement scans to one page and stores a cursor', async () => {
    const firstPageDocs = Array.from({ length: 50 }, (_, index) => ({
      id: `free-user-${index}`,
      data: () => ({ disconnectState: 'disconnect_pending' }),
    }));
    const pendingRootQuery = buildPagedQuery([firstPageDocs]);
    const cursorRef = buildCursorRef();
    hoisted.collection.mockImplementation((path: string) => {
      if (path === 'suuntoAppAccessTokens') {
        return pendingRootQuery;
      }

      return {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn().mockImplementation(async () => ({
          empty: path.includes('entitled-user') ? false : true,
          docs: path.includes('entitled-user') ? [{ data: () => ({ role: 'pro' }) }] : [],
        })),
      };
    });
    hoisted.doc.mockImplementation((path: string) => {
      if (path.startsWith('pendingServiceDisconnectRetryCursors/')) {
        return cursorRef;
      }

      return {
        get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      };
    });

    const clearedCount = await retryPendingServiceDisconnectsTestInternals.clearPendingDisconnectsForRestoredEntitlements(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
    );

    expect(clearedCount).toBe(0);
    expect(pendingRootQuery.get).toHaveBeenCalledTimes(1);
    expect(cursorRef.set).toHaveBeenCalledWith({ documentId: 'free-user-49' }, { merge: true });
    expect(hoisted.clearServiceDisconnectPending).not.toHaveBeenCalled();
  });

  it('uses restored-entitlement cursors so later pending roots are not starved', async () => {
    const entitledRoot = {
      id: 'entitled-user',
      data: () => ({ disconnectState: 'disconnect_pending' }),
    };
    const pendingRootQuery = buildPagedQuery([[entitledRoot]]);
    const cursorRef = buildCursorRef({ documentId: 'free-user-49' });
    hoisted.collection.mockImplementation((path: string) => {
      if (path === 'suuntoAppAccessTokens') {
        return pendingRootQuery;
      }

      return {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: vi.fn().mockImplementation(async () => ({
          empty: path.includes('entitled-user') ? false : true,
          docs: path.includes('entitled-user') ? [{ data: () => ({ role: 'pro' }) }] : [],
        })),
      };
    });
    hoisted.doc.mockImplementation((path: string) => {
      if (path.startsWith('pendingServiceDisconnectRetryCursors/')) {
        return cursorRef;
      }

      return {
        get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      };
    });

    const clearedCount = await retryPendingServiceDisconnectsTestInternals.clearPendingDisconnectsForRestoredEntitlements(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
    );

    expect(clearedCount).toBe(1);
    expect(pendingRootQuery.get).toHaveBeenCalledTimes(1);
    expect(pendingRootQuery.startAfter).toHaveBeenCalledWith('free-user-49');
    expect(cursorRef.delete).toHaveBeenCalled();
    expect(hoisted.clearServiceDisconnectPending).toHaveBeenCalledWith('entitled-user', ServiceNames.SuuntoApp);
  });

  it('bounds due pending disconnect root scans to one page and stores a cursor', async () => {
    const nextAttemptAt = { toMillis: () => 500 };
    const firstPageDocs = Array.from({ length: 50 }, (_, index) => ({
      id: `due-user-${index}`,
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectNextAttemptAt: nextAttemptAt,
      }),
    }));
    const dueQuery = buildPagedQuery([firstPageDocs]);
    const cursorRef = buildCursorRef();
    hoisted.collection.mockReturnValue(dueQuery);
    hoisted.doc.mockImplementation((path: string) => {
      if (path.startsWith('pendingServiceDisconnectRetryCursors/')) {
        return cursorRef;
      }

      return {
        get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      };
    });

    const roots = await retryPendingServiceDisconnectsTestInternals.getDuePendingDisconnectRoots(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
      { toMillis: () => 1_000 } as any,
    );

    expect(roots).toHaveLength(50);
    expect(dueQuery.get).toHaveBeenCalledTimes(1);
    expect(dueQuery.orderBy).toHaveBeenCalledWith('disconnectNextAttemptAt');
    expect(dueQuery.orderBy).toHaveBeenCalledWith('__name__');
    expect(dueQuery.startAfter).not.toHaveBeenCalled();
    expect(cursorRef.set).toHaveBeenCalledWith({
      documentId: 'due-user-49',
      disconnectNextAttemptAt: nextAttemptAt,
    }, { merge: true });
  });

  it('wraps due pending disconnect root scans when a stored cursor reaches EOF', async () => {
    const cursorNextAttemptAt = { toMillis: () => 500 };
    const wrappedNextAttemptAt = { toMillis: () => 600 };
    const wrappedDoc = {
      id: 'due-user-0',
      data: () => ({
        disconnectState: 'disconnect_pending',
        disconnectNextAttemptAt: wrappedNextAttemptAt,
      }),
    };
    const dueQuery = buildPagedQuery([
      [],
      [wrappedDoc],
    ]);
    const cursorRef = buildCursorRef({
      documentId: 'due-user-49',
      disconnectNextAttemptAt: cursorNextAttemptAt,
    });
    hoisted.collection.mockReturnValue(dueQuery);
    hoisted.doc.mockImplementation((path: string) => {
      if (path.startsWith('pendingServiceDisconnectRetryCursors/')) {
        return cursorRef;
      }

      return {
        get: vi.fn().mockResolvedValue({ data: () => ({}) }),
      };
    });

    const roots = await retryPendingServiceDisconnectsTestInternals.getDuePendingDisconnectRoots(
      { serviceName: ServiceNames.SuuntoApp, collectionName: 'suuntoAppAccessTokens' },
      { toMillis: () => 1_000 } as any,
    );

    expect(roots).toEqual([wrappedDoc]);
    expect(dueQuery.startAfter).toHaveBeenCalledWith(cursorNextAttemptAt, 'due-user-49');
    expect(dueQuery.get).toHaveBeenCalledTimes(2);
    expect(cursorRef.delete).toHaveBeenCalledTimes(2);
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
