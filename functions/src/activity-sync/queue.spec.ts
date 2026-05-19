import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';

const {
  mockGet,
  mockSet,
  mockUpdate,
  mockDoc,
  mockCollection,
  mockTransactionGet,
  mockTransactionSet,
  mockRunTransaction,
  mockEnqueueActivitySyncTask,
  mockGenerateIDFromParts,
  mockGetExpireAtTimestamp,
  mockGetUserDeletionGuardStateInTransaction,
} = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockSet = vi.fn().mockResolvedValue(undefined);
  const mockUpdate = vi.fn().mockResolvedValue(undefined);
  const mockTransactionGet = vi.fn();
  const mockTransactionSet = vi.fn();
  const mockRunTransaction = vi.fn(async (runner: (transaction: {
    get: typeof mockTransactionGet;
    set: typeof mockTransactionSet;
  }) => unknown) => runner({
    get: mockTransactionGet,
    set: mockTransactionSet,
  }));
  const mockDoc = vi.fn(() => ({
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
    mockRunTransaction,
    mockEnqueueActivitySyncTask: vi.fn().mockResolvedValue(true),
    mockGenerateIDFromParts: vi.fn(async (parts: string[]) => parts.join('__')),
    mockGetExpireAtTimestamp: vi.fn(() => new Date('2026-01-01T00:00:00.000Z')),
    mockGetUserDeletionGuardStateInTransaction: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  }),
}));

vi.mock('../utils', () => ({
  enqueueActivitySyncTask: mockEnqueueActivitySyncTask,
  generateIDFromParts: mockGenerateIDFromParts,
}));

vi.mock('../shared/ttl-config', () => ({
  getExpireAtTimestamp: mockGetExpireAtTimestamp,
  TTL_CONFIG: {
    QUEUE_ITEM_IN_DAYS: 14,
  },
}));

vi.mock('../shared/user-deletion-guard', () => ({
  getUserDeletionGuardStateInTransaction: mockGetUserDeletionGuardStateInTransaction,
}));

import { buildActivitySyncQueueItemId, enqueueActivitySyncQueueItem } from './queue';

describe('activity-sync/queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.mockReturnValue({ get: mockGet, set: mockSet, update: mockUpdate });
    mockRunTransaction.mockImplementation(async (runner: (transaction: {
      get: typeof mockTransactionGet;
      set: typeof mockTransactionSet;
    }) => unknown) => runner({
      get: mockTransactionGet,
      set: mockTransactionSet,
    }));
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('builds deterministic queue item IDs', async () => {
    const id = await buildActivitySyncQueueItemId(
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      'user-1',
      'event-1',
    );

    expect(id).toBe('activitySync__GarminAPI_to_SuuntoApp__user-1__event-1');
    expect(mockGenerateIDFromParts).toHaveBeenCalledWith([
      'activitySync',
      ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      'user-1',
      'event-1',
    ]);
  });

  it('enqueues a new activity sync queue item and dispatches cloud task', async () => {
    mockTransactionGet.mockResolvedValueOnce({ exists: false });

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceActivityID: 'activity-1',
      originalFile: {
        path: 'users/user-1/events/event-1/original.fit',
        extension: 'fit',
      },
      manual: false,
    });

    expect(result).toEqual({
      enqueued: true,
      queueItemId: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
    });
    expect(mockTransactionSet).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      id: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      processed: false,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceActivityID: 'activity-1',
      manual: false,
      originalFile: expect.objectContaining({ path: 'users/user-1/events/event-1/original.fit' }),
    }));
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith(
      'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      expect.any(Number),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
  });

  it('returns already_pending when queue item exists and is not processed', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ processed: false, dispatchedToCloudTask: 123, dateCreated: 1700000000000 }),
    });

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      originalFile: { path: 'p.fit', extension: 'fit' },
      manual: false,
    });

    expect(result).toEqual({
      enqueued: false,
      queueItemId: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      reason: 'already_pending',
    });
    expect(mockTransactionSet).not.toHaveBeenCalled();
    expect(mockEnqueueActivitySyncTask).not.toHaveBeenCalled();
  });

  it('re-dispatches an existing pending item when it was not dispatched to Cloud Tasks', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ processed: false, dispatchedToCloudTask: null, dateCreated: 1700000000000 }),
    });

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      originalFile: { path: 'p.fit', extension: 'fit' },
      manual: false,
    });

    expect(result).toEqual({
      enqueued: false,
      queueItemId: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      reason: 'already_pending',
      redispatched: true,
    });
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith(
      'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      1700000000000,
    );
    expect(mockUpdate).toHaveBeenCalledWith({ dispatchedToCloudTask: expect.any(Number) });
  });

  it('does not mark existing pending item as redispatched when Cloud Task already exists', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ processed: false, dispatchedToCloudTask: null, dateCreated: 1700000000000 }),
    });
    mockEnqueueActivitySyncTask.mockResolvedValueOnce(false);

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      originalFile: { path: 'p.fit', extension: 'fit' },
      manual: false,
    });

    expect(result).toEqual({
      enqueued: false,
      queueItemId: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      reason: 'already_pending',
    });
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith(
      'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      1700000000000,
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps new queue item undispatched when Cloud Task enqueue returns false', async () => {
    mockTransactionGet.mockResolvedValueOnce({ exists: false });
    mockEnqueueActivitySyncTask.mockResolvedValueOnce(false);

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceActivityID: 'activity-1',
      originalFile: {
        path: 'users/user-1/events/event-1/original.fit',
        extension: 'fit',
      },
      manual: false,
    });

    expect(result).toEqual({
      enqueued: true,
      queueItemId: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
    });
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith(
      'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      expect.any(Number),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not write or dispatch queue items when user deletion is active inside the transaction', async () => {
    mockTransactionGet.mockResolvedValueOnce({ exists: false });
    mockGetUserDeletionGuardStateInTransaction.mockResolvedValueOnce({
      userExists: true,
      deletionInProgress: true,
      shouldSkip: true,
    });

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      originalFile: { path: 'p.fit', extension: 'fit' },
      manual: false,
    });

    expect(result).toEqual({
      enqueued: false,
      queueItemId: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      reason: 'user_deleted_or_deleting',
    });
    expect(mockTransactionSet).not.toHaveBeenCalled();
    expect(mockEnqueueActivitySyncTask).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns already_processed for automatic enqueue when an item is already processed', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ processed: true }),
    });

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      originalFile: { path: 'p.fit', extension: 'fit' },
      manual: false,
    });

    expect(result).toEqual({
      enqueued: false,
      queueItemId: 'activitySync__GarminAPI_to_SuuntoApp__user-1__event-1',
      reason: 'already_processed',
    });
    expect(mockTransactionSet).not.toHaveBeenCalled();
  });

  it('re-enqueues processed items for manual backfill requests', async () => {
    mockTransactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ processed: true }),
    });

    const result = await enqueueActivitySyncQueueItem({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      originalFile: { path: 'p.fit', extension: 'fit' },
      manual: true,
    });

    expect(result.enqueued).toBe(true);
    expect(mockTransactionSet).toHaveBeenCalled();
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalled();
  });
});
