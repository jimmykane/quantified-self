import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

interface FirestoreDocMock {
  id?: string;
  ref: unknown;
  data: () => Record<string, unknown>;
}

const {
  mockCollection,
  mockCollectionGroup,
  mockCollectionGroupWhere,
  mockRecursiveDelete,
  mockMappingDelete,
  mockRunTransaction,
  mockMarkQueueItemDeletedForUserCleanup,
  queryDocsByKey,
  activeTokenDocs,
  mappingDataById,
  mappingTransferOnFirstTransactionAttempt,
} = vi.hoisted(() => {
  const queryDocsByKey = new Map<string, FirestoreDocMock[]>();
  const activeTokenDocs: FirestoreDocMock[] = [];
  const mappingDataById = new Map<string, Record<string, unknown>>();
  const mappingTransferOnFirstTransactionAttempt = new Map<string, Record<string, unknown>>();
  const mockRecursiveDelete = vi.fn().mockResolvedValue(undefined);
  const mockMappingDelete = vi.fn().mockResolvedValue(undefined);
  const mockMarkQueueItemDeletedForUserCleanup = vi.fn().mockResolvedValue(true);

  const buildSnapshot = (docs: FirestoreDocMock[]) => ({
    empty: docs.length === 0,
    size: docs.length,
    docs,
  });

  const mockCollection = vi.fn((collectionName: string) => ({
    where: vi.fn((fieldName: string, _operator: string, value: string) => ({
      get: vi.fn().mockResolvedValue(buildSnapshot(
        queryDocsByKey.get(`${collectionName}:${fieldName}:${value}`) || [],
      )),
    })),
    doc: vi.fn((id: string) => ({ path: `${collectionName}/${id}` })),
  }));

  const mockRunTransaction = vi.fn(async (handler: (transaction: {
    get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
    delete: (ref: { path: string }) => void;
  }) => Promise<boolean>) => {
    const executeAttempt = async () => {
      const pendingDeletes: Array<{ path: string }> = [];
      const result = await handler({
        get: async (ref) => {
          const key = ref.path.replace('/', ':');
          return {
            exists: mappingDataById.has(key),
            data: () => mappingDataById.get(key),
          };
        },
        delete: (ref) => pendingDeletes.push(ref),
      });
      return { pendingDeletes, result };
    };

    const firstAttempt = await executeAttempt();
    const transferredMapping = firstAttempt.pendingDeletes
      .map((ref) => ({ ref, data: mappingTransferOnFirstTransactionAttempt.get(ref.path.replace('/', ':')) }))
      .find(({ data }) => !!data);
    if (transferredMapping?.data) {
      mappingDataById.set(transferredMapping.ref.path.replace('/', ':'), transferredMapping.data);
      mappingTransferOnFirstTransactionAttempt.delete(transferredMapping.ref.path.replace('/', ':'));
      const retry = await executeAttempt();
      for (const ref of retry.pendingDeletes) {
        mappingDataById.delete(ref.path.replace('/', ':'));
        mockMappingDelete(ref);
      }
      return retry.result;
    }

    for (const ref of firstAttempt.pendingDeletes) {
      mappingDataById.delete(ref.path.replace('/', ':'));
      mockMappingDelete(ref);
    }
    return firstAttempt.result;
  });

  const mockCollectionGroupWhere = vi.fn();
  const mockCollectionGroup = vi.fn(() => {
    const predicates: Array<{ fieldName: string; value: string }> = [];
    const query = {
      where: (fieldName: string, _operator: string, value: string) => {
        mockCollectionGroupWhere(fieldName, _operator, value);
        predicates.push({ fieldName, value });
        return query;
      },
      get: vi.fn().mockImplementation(() => Promise.resolve(buildSnapshot(activeTokenDocs.filter((doc) => {
        const data = doc.data();
        return predicates.every(({ fieldName, value }) => data[fieldName] === value);
      })))),
    };
    return query;
  });

  return {
    mockCollection,
    mockCollectionGroup,
    mockCollectionGroupWhere,
    mockRecursiveDelete,
    mockMappingDelete,
    mockRunTransaction,
    mockMarkQueueItemDeletedForUserCleanup,
    queryDocsByKey,
    activeTokenDocs,
    mappingDataById,
    mappingTransferOnFirstTransactionAttempt,
  };
});

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: mockCollection,
    collectionGroup: mockCollectionGroup,
    recursiveDelete: mockRecursiveDelete,
    runTransaction: mockRunTransaction,
  }), {});

  return {
    default: { firestore },
    firestore,
  };
});

vi.mock('./queue/cleanup-tombstone', () => ({
  markQueueItemDeletedForUserCleanup: mockMarkQueueItemDeletedForUserCleanup,
  QUEUE_CLEANUP_TOMBSTONE_REASONS: {
    AccountDeletionCleanup: 'account_deletion_cleanup',
    ServiceDisconnectCleanup: 'service_disconnect_cleanup',
    UserDeletionGuard: 'user_deletion_guard',
  },
}));

import { cleanupProviderOperationalDocsForServiceToken } from './service-operational-cleanup';

function makeDoc(path: string, data: Record<string, unknown>): FirestoreDocMock {
  return {
    id: path.split('/').pop() || path,
    ref: { path },
    data: () => data,
  };
}

function setQueryDocs(collectionName: string, fieldName: string, value: string, docs: FirestoreDocMock[]) {
  queryDocsByKey.set(`${collectionName}:${fieldName}:${value}`, docs);
}

describe('cleanupProviderOperationalDocsForServiceToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryDocsByKey.clear();
    activeTokenDocs.length = 0;
    mappingDataById.clear();
    mappingTransferOnFirstTransactionAttempt.clear();
  });

  it('deletes provider-keyed queue and DLQ docs while the service token still exposes the provider id', async () => {
    setQueryDocs('suuntoAppWorkoutQueue', 'userName', 'suunto-user', [
      makeDoc('suuntoAppWorkoutQueue/workout-1', { userName: 'suunto-user' }),
    ]);
    setQueryDocs('sleepSyncQueue', 'providerUserId', 'suunto-user', [
      makeDoc('sleepSyncQueue/sleep-1', { provider: 'SuuntoApp', providerUserId: 'suunto-user' }),
    ]);
    setQueryDocs('routeDeliverySyncQueue', 'sourceProviderUserId', 'suunto-user', [
      makeDoc('routeDeliverySyncQueue/route-delivery-1', {
        userID: 'firebase-user-123',
        sourceServiceName: ServiceNames.SuuntoApp,
        sourceProviderUserId: 'suunto-user',
        destinationServiceName: ServiceNames.GarminAPI,
      }),
      makeDoc('routeDeliverySyncQueue/not-suunto-source', {
        userID: 'firebase-user-123',
        sourceServiceName: ServiceNames.GarminAPI,
        sourceProviderUserId: 'suunto-user',
        destinationServiceName: ServiceNames.SuuntoApp,
      }),
    ]);
    setQueryDocs('failed_jobs', 'userName', 'suunto-user', [
      makeDoc('failed_jobs/workout-dlq-1', { originalCollection: 'suuntoAppWorkoutQueue', userName: 'suunto-user' }),
    ]);
    setQueryDocs('failed_jobs', 'providerUserId', 'suunto-user', [
      makeDoc('failed_jobs/sleep-dlq-1', { originalCollection: 'sleepSyncQueue', provider: 'SuuntoApp', providerUserId: 'suunto-user' }),
    ]);
    setQueryDocs('failed_jobs', 'sourceProviderUserId', 'suunto-user', [
      makeDoc('failed_jobs/route-delivery-dlq-1', {
        originalCollection: 'routeDeliverySyncQueue',
        userID: 'firebase-user-123',
        sourceServiceName: ServiceNames.SuuntoApp,
        sourceProviderUserId: 'suunto-user',
        destinationServiceName: ServiceNames.GarminAPI,
      }),
      makeDoc('failed_jobs/not-suunto-source-dlq', {
        originalCollection: 'routeDeliverySyncQueue',
        userID: 'firebase-user-123',
        sourceServiceName: ServiceNames.GarminAPI,
        sourceProviderUserId: 'suunto-user',
        destinationServiceName: ServiceNames.SuuntoApp,
      }),
    ]);

    const result = await cleanupProviderOperationalDocsForServiceToken(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        userName: 'suunto-user',
      },
    );

    expect(result).toMatchObject({
      providerUserId: 'suunto-user',
      deletedDocCount: 6,
      skippedForActiveConnection: false,
    });
    expect(mockRecursiveDelete).toHaveBeenCalledTimes(6);
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'suuntoAppWorkoutQueue/workout-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'sleepSyncQueue/sleep-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'routeDeliverySyncQueue/route-delivery-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'failed_jobs/workout-dlq-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'failed_jobs/sleep-dlq-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'failed_jobs/route-delivery-dlq-1' }));
    expect(mockRecursiveDelete).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'routeDeliverySyncQueue/not-suunto-source' }));
    expect(mockRecursiveDelete).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'failed_jobs/not-suunto-source-dlq' }));
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'suuntoAppWorkoutQueue',
      'workout-1',
      'service_disconnect_cleanup',
    );
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'routeDeliverySyncQueue',
      'route-delivery-1',
      'service_disconnect_cleanup',
    );
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'routeDeliverySyncQueue',
      'route-delivery-dlq-1',
      'service_disconnect_cleanup',
    );
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'sleepSyncQueue',
      'sleep-dlq-1',
      'service_disconnect_cleanup',
    );
  });

  it('preserves provider-only docs when an active connection still owns the provider id', async () => {
    activeTokenDocs.push({
      id: 'active-token',
      data: () => ({ serviceName: ServiceNames.SuuntoApp, userName: 'suunto-user' }),
      ref: {
        parent: {
          parent: {
            id: 'other-firebase-user',
            parent: { id: 'suuntoAppAccessTokens' },
          },
        },
      },
    });
    setQueryDocs('suuntoAppWorkoutQueue', 'userName', 'suunto-user', [
      makeDoc('suuntoAppWorkoutQueue/provider-only-workout', { userName: 'suunto-user' }),
      makeDoc('suuntoAppWorkoutQueue/explicit-user-workout', { userName: 'suunto-user', firebaseUserID: 'firebase-user-123' }),
      makeDoc('suuntoAppWorkoutQueue/other-user-workout', { userName: 'suunto-user', firebaseUserID: 'other-firebase-user' }),
    ]);

    const result = await cleanupProviderOperationalDocsForServiceToken(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        userName: 'suunto-user',
      },
    );

    expect(result).toMatchObject({
      providerUserId: 'suunto-user',
      deletedDocCount: 1,
      skippedForActiveConnection: true,
    });
    expect(mockRecursiveDelete).toHaveBeenCalledTimes(1);
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
      path: 'suuntoAppWorkoutQueue/explicit-user-workout',
    }));
    expect(mockRecursiveDelete).not.toHaveBeenCalledWith(expect.objectContaining({
      path: 'suuntoAppWorkoutQueue/provider-only-workout',
    }));
    expect(mockRecursiveDelete).not.toHaveBeenCalledWith(expect.objectContaining({
      path: 'suuntoAppWorkoutQueue/other-user-workout',
    }));
  });

  it('does not preserve provider-only docs for token snapshots without serviceName', async () => {
    activeTokenDocs.push({
      id: 'token-without-service-name',
      data: () => ({ userName: 'suunto-user' }),
      ref: {
        parent: {
          parent: {
            id: 'other-firebase-user',
            parent: { id: 'suuntoAppAccessTokens' },
          },
        },
      },
    });
    setQueryDocs('suuntoAppWorkoutQueue', 'userName', 'suunto-user', [
      makeDoc('suuntoAppWorkoutQueue/provider-only-workout', { userName: 'suunto-user' }),
    ]);

    const result = await cleanupProviderOperationalDocsForServiceToken(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        userName: 'suunto-user',
      },
    );

    expect(result).toMatchObject({
      providerUserId: 'suunto-user',
      deletedDocCount: 1,
      skippedForActiveConnection: false,
    });
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
      path: 'suuntoAppWorkoutQueue/provider-only-workout',
    }));
  });

  it('does not treat ambiguous failed_jobs userID docs as Garmin provider-owned without Garmin queue shape', async () => {
    setQueryDocs('failed_jobs', 'userID', 'garmin-provider-user', [
      makeDoc('failed_jobs/ambiguous-firebase-user-job', { userID: 'garmin-provider-user' }),
      makeDoc('failed_jobs/legacy-garmin-job', {
        userID: 'garmin-provider-user',
        activityFileID: 'activity-file-1',
      }),
    ]);

    const result = await cleanupProviderOperationalDocsForServiceToken(
      'firebase-user-123',
      ServiceNames.GarminAPI,
      {
        serviceName: ServiceNames.GarminAPI,
        userID: 'garmin-provider-user',
      },
    );

    expect(result.deletedDocCount).toBe(1);
    expect(mockRecursiveDelete).toHaveBeenCalledTimes(1);
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({
      path: 'failed_jobs/legacy-garmin-job',
    }));
    expect(mockRecursiveDelete).not.toHaveBeenCalledWith(expect.objectContaining({
      path: 'failed_jobs/ambiguous-firebase-user-job',
    }));
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'garminAPIActivityQueue',
      'legacy-garmin-job',
      'service_disconnect_cleanup',
    );
  });

  it('preserves provider-keyed operational docs when cleanup tombstone write fails', async () => {
    mockMarkQueueItemDeletedForUserCleanup.mockResolvedValueOnce(false);
    setQueryDocs('suuntoAppWorkoutQueue', 'userName', 'suunto-user', [
      makeDoc('suuntoAppWorkoutQueue/workout-1', { userName: 'suunto-user' }),
    ]);

    const result = await cleanupProviderOperationalDocsForServiceToken(
      'firebase-user-123',
      ServiceNames.SuuntoApp,
      {
        serviceName: ServiceNames.SuuntoApp,
        userName: 'suunto-user',
      },
    );

    expect(result).toMatchObject({
      providerUserId: 'suunto-user',
      deletedDocCount: 0,
      skippedForActiveConnection: false,
    });
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'suuntoAppWorkoutQueue',
      'workout-1',
      'service_disconnect_cleanup',
    );
    expect(mockRecursiveDelete).not.toHaveBeenCalled();
  });

  it('deletes a disconnected Wahoo user mapping owned by the Firebase user', async () => {
    mappingDataById.set('wahooAPIUserMappings:wahoo-user', {
      firebaseUserID: 'firebase-user-123',
      wahooUserID: 'wahoo-user',
    });

    const result = await cleanupProviderOperationalDocsForServiceToken(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      {
        serviceName: ServiceNames.WahooAPI,
        wahooUserID: 'wahoo-user',
      },
    );

    expect(result).toMatchObject({
      providerUserId: 'wahoo-user',
      deletedDocCount: 1,
      skippedForActiveConnection: false,
    });
    expect(mockMappingDelete).toHaveBeenCalledOnce();
    expect(mockCollectionGroupWhere).toHaveBeenNthCalledWith(
      1,
      'wahooUserID',
      '==',
      'wahoo-user',
    );
    expect(mockCollectionGroupWhere).toHaveBeenNthCalledWith(
      2,
      'serviceName',
      '==',
      ServiceNames.WahooAPI,
    );
  });

  it('preserves a Wahoo mapping transferred to another Firebase user while cleanup is in flight', async () => {
    mappingDataById.set('wahooAPIUserMappings:wahoo-user', {
      firebaseUserID: 'firebase-user-123',
      wahooUserID: 'wahoo-user',
    });
    mappingTransferOnFirstTransactionAttempt.set('wahooAPIUserMappings:wahoo-user', {
      firebaseUserID: 'new-firebase-user',
      wahooUserID: 'wahoo-user',
    });

    const result = await cleanupProviderOperationalDocsForServiceToken(
      'firebase-user-123',
      ServiceNames.WahooAPI,
      {
        serviceName: ServiceNames.WahooAPI,
        wahooUserID: 'wahoo-user',
      },
    );

    expect(result.deletedDocCount).toBe(0);
    expect(mockRunTransaction).toHaveBeenCalledOnce();
    expect(mockMappingDelete).not.toHaveBeenCalled();
    expect(mappingDataById.get('wahooAPIUserMappings:wahoo-user')).toMatchObject({
      firebaseUserID: 'new-firebase-user',
    });
  });
});
