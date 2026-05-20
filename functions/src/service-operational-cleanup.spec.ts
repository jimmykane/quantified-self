import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';

const {
  mockCollection,
  mockCollectionGroup,
  mockRecursiveDelete,
  mockMarkQueueItemDeletedForUserCleanup,
  queryDocsByKey,
  activeTokenDocs,
} = vi.hoisted(() => {
  const queryDocsByKey = new Map<string, any[]>();
  const activeTokenDocs: any[] = [];
  const mockRecursiveDelete = vi.fn().mockResolvedValue(undefined);
  const mockMarkQueueItemDeletedForUserCleanup = vi.fn().mockResolvedValue(true);

  const buildSnapshot = (docs: any[]) => ({
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
  }));

  const mockCollectionGroup = vi.fn(() => ({
    where: vi.fn((_fieldName: string, _operator: string, _value: string) => ({
      get: vi.fn().mockResolvedValue(buildSnapshot(activeTokenDocs)),
    })),
  }));

  return {
    mockCollection,
    mockCollectionGroup,
    mockRecursiveDelete,
    mockMarkQueueItemDeletedForUserCleanup,
    queryDocsByKey,
    activeTokenDocs,
  };
});

vi.mock('firebase-admin', () => {
  const firestore = Object.assign(() => ({
    collection: mockCollection,
    collectionGroup: mockCollectionGroup,
    recursiveDelete: mockRecursiveDelete,
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

vi.mock('./auth/factory', () => ({
  getServiceAdapter: vi.fn((serviceName: ServiceNames) => ({
    tokenCollectionName: serviceName === ServiceNames.SuuntoApp
      ? 'suuntoAppAccessTokens'
      : serviceName === ServiceNames.COROSAPI
        ? 'COROSAPIAccessTokens'
        : 'garminAPITokens',
  })),
}));

import { cleanupProviderOperationalDocsForServiceToken } from './service-operational-cleanup';

function makeDoc(path: string, data: Record<string, unknown>) {
  return {
    id: path.split('/').pop(),
    ref: { path },
    data: () => data,
  };
}

function setQueryDocs(collectionName: string, fieldName: string, value: string, docs: any[]) {
  queryDocsByKey.set(`${collectionName}:${fieldName}:${value}`, docs);
}

describe('cleanupProviderOperationalDocsForServiceToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryDocsByKey.clear();
    activeTokenDocs.length = 0;
  });

  it('deletes provider-keyed queue and DLQ docs while the service token still exposes the provider id', async () => {
    setQueryDocs('suuntoAppWorkoutQueue', 'userName', 'suunto-user', [
      makeDoc('suuntoAppWorkoutQueue/workout-1', { userName: 'suunto-user' }),
    ]);
    setQueryDocs('sleepSyncQueue', 'providerUserId', 'suunto-user', [
      makeDoc('sleepSyncQueue/sleep-1', { provider: 'SuuntoApp', providerUserId: 'suunto-user' }),
    ]);
    setQueryDocs('failed_jobs', 'userName', 'suunto-user', [
      makeDoc('failed_jobs/workout-dlq-1', { originalCollection: 'suuntoAppWorkoutQueue', userName: 'suunto-user' }),
    ]);
    setQueryDocs('failed_jobs', 'providerUserId', 'suunto-user', [
      makeDoc('failed_jobs/sleep-dlq-1', { originalCollection: 'sleepSyncQueue', provider: 'SuuntoApp', providerUserId: 'suunto-user' }),
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
      deletedDocCount: 4,
      skippedForActiveConnection: false,
    });
    expect(mockRecursiveDelete).toHaveBeenCalledTimes(4);
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'suuntoAppWorkoutQueue/workout-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'sleepSyncQueue/sleep-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'failed_jobs/workout-dlq-1' }));
    expect(mockRecursiveDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'failed_jobs/sleep-dlq-1' }));
    expect(mockMarkQueueItemDeletedForUserCleanup).toHaveBeenCalledWith(
      'suuntoAppWorkoutQueue',
      'workout-1',
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
      data: () => ({ serviceName: ServiceNames.SuuntoApp }),
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
});
