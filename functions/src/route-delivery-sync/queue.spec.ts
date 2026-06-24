import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_DELIVERY_SYNC_ROUTE_IDS } from '../../../shared/route-delivery-sync-routes';

const {
  mockGet,
  mockSet,
  mockUpdate,
  mockDoc,
  mockCollection,
  mockTransactionGet,
  mockTransactionSet,
  mockRunTransaction,
  mockEnqueueRouteDeliverySyncTask,
  mockGenerateIDFromParts,
  mockGetExpireAtTimestamp,
  mockRecursiveDelete,
  mockGetUserDeletionGuardState,
  mockGetUserDeletionGuardStateInTransaction,
  mockMarkQueueItemDeletedForUserCleanup,
} = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockSet = vi.fn().mockResolvedValue(undefined);
  const mockUpdate = vi.fn().mockResolvedValue(undefined);
  const mockTransactionGet = vi.fn();
  const mockTransactionSet = vi.fn();
  const mockTransactionUpdate = vi.fn((ref: { update?: (data: unknown) => Promise<void> }, data: unknown) => ref.update?.(data));
  const mockRunTransaction = vi.fn(async (runner: (transaction: {
    get: typeof mockTransactionGet;
    set: typeof mockTransactionSet;
    update: typeof mockTransactionUpdate;
  }) => unknown) => runner({
    get: mockTransactionGet,
    set: mockTransactionSet,
    update: mockTransactionUpdate,
  }));
  const mockDoc = vi.fn(() => ({
    parent: { id: 'routeDeliverySyncQueue' },
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
  }));
  const mockCollection = vi.fn(() => ({
    doc: mockDoc,
  }));
  return {
    mockGet,
    mockSet,
    mockUpdate,
    mockDoc,
    mockCollection,
    mockTransactionGet,
    mockTransactionSet,
    mockTransactionUpdate,
    mockRunTransaction,
    mockEnqueueRouteDeliverySyncTask: vi.fn().mockResolvedValue(true),
    mockGenerateIDFromParts: vi.fn(async (parts: string[]) => parts.join('__')),
    mockGetExpireAtTimestamp: vi.fn(() => new Date('2026-01-01T00:00:00.000Z')),
    mockRecursiveDelete: vi.fn().mockResolvedValue(undefined),
    mockGetUserDeletionGuardState: vi.fn(),
    mockGetUserDeletionGuardStateInTransaction: vi.fn(),
    mockMarkQueueItemDeletedForUserCleanup: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: mockCollection,
    runTransaction: mockRunTransaction,
    recursiveDelete: mockRecursiveDelete,
  }),
}));

vi.mock('../utils', () => ({
  enqueueRouteDeliverySyncTask: mockEnqueueRouteDeliverySyncTask,
  generateIDFromParts: mockGenerateIDFromParts,
}));

vi.mock('../shared/ttl-config', () => ({
  getExpireAtTimestamp: mockGetExpireAtTimestamp,
  TTL_CONFIG: {
    QUEUE_ITEM_IN_DAYS: 14,
  },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardState: mockGetUserDeletionGuardState,
  getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError: class UserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
  },
}));

vi.mock('../queue/cleanup-tombstone', () => ({
  markQueueItemDeletedForUserCleanup: mockMarkQueueItemDeletedForUserCleanup,
  QUEUE_CLEANUP_TOMBSTONE_REASONS: {
    UserDeletionGuard: 'user_deletion_guard',
  },
}));

import { buildRouteDeliverySyncQueueItemId, enqueueRouteDeliverySyncQueueItem } from './queue';

describe('route-delivery-sync/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.mockReturnValue({ parent: { id: 'routeDeliverySyncQueue' }, get: mockGet, set: mockSet, update: mockUpdate });
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mockGetUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
    mockMarkQueueItemDeletedForUserCleanup.mockResolvedValue(true);
  });

  it('builds deterministic queue item IDs with the source revision key', async () => {
    const id = await buildRouteDeliverySyncQueueItemId(
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      'user-1',
      'route-1',
      'SuuntoApp:provider-route-1:1710000000000',
    );

    expect(id).toBe('routeDeliverySync__SuuntoApp_to_GarminAPI__user-1__route-1__SuuntoApp:provider-route-1:1710000000000');
    expect(mockGenerateIDFromParts).toHaveBeenCalledWith([
      'routeDeliverySync',
      ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      'user-1',
      'route-1',
      'SuuntoApp:provider-route-1:1710000000000',
    ]);
  });

  it('enqueues a new route delivery sync queue item and dispatches Cloud Task', async () => {
    mockTransactionGet.mockResolvedValueOnce({ exists: false });

    const result = await enqueueRouteDeliverySyncQueueItem({
      routeId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      sourceServiceName: ServiceNames.SuuntoApp,
      destinationServiceName: ServiceNames.GarminAPI,
      userID: 'user-1',
      savedRouteID: 'route-1',
      sourceRevisionKey: 'rev-1',
      sourceProviderRouteId: 'provider-route-1',
      sourceProviderUserId: 'suunto-user',
      manual: false,
    });

    expect(result).toEqual({
      enqueued: true,
      queueItemId: 'routeDeliverySync__SuuntoApp_to_GarminAPI__user-1__route-1__rev-1',
    });
    expect(mockTransactionSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      routeId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      savedRouteID: 'route-1',
      sourceRevisionKey: 'rev-1',
      sourceProviderRouteId: 'provider-route-1',
      sourceProviderUserId: 'suunto-user',
      expireAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
    expect(mockEnqueueRouteDeliverySyncTask).toHaveBeenCalledWith(
      'routeDeliverySync__SuuntoApp_to_GarminAPI__user-1__route-1__rev-1',
      expect.any(Number),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
  });

  it('does not mark an existing pending item as redispatched when Cloud Task already exists', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ processed: false, dispatchedToCloudTask: null, dateCreated: 1700000000000 }),
    });
    mockEnqueueRouteDeliverySyncTask.mockResolvedValueOnce(false);

    const result = await enqueueRouteDeliverySyncQueueItem({
      routeId: ROUTE_DELIVERY_SYNC_ROUTE_IDS.SuuntoApp_to_GarminAPI,
      sourceServiceName: ServiceNames.SuuntoApp,
      destinationServiceName: ServiceNames.GarminAPI,
      userID: 'user-1',
      savedRouteID: 'route-1',
      sourceRevisionKey: 'rev-1',
      manual: false,
    });

    expect(result).toEqual({
      enqueued: false,
      queueItemId: 'routeDeliverySync__SuuntoApp_to_GarminAPI__user-1__route-1__rev-1',
      reason: 'already_pending',
    });
    expect(mockEnqueueRouteDeliverySyncTask).toHaveBeenCalledWith(
      'routeDeliverySync__SuuntoApp_to_GarminAPI__user-1__route-1__rev-1',
      1700000000000,
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
