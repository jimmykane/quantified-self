import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSet,
  mockServerTimestamp,
  mockDelete,
  mockIncrement,
  mockGetUserDeletionGuardState,
} = vi.hoisted(() => ({
  mockSet: vi.fn().mockResolvedValue(undefined),
  mockServerTimestamp: vi.fn(() => '__server_timestamp__'),
  mockDelete: vi.fn(() => '__delete__'),
  mockIncrement: vi.fn((value: number) => `__increment_${value}__`),
  mockGetUserDeletionGuardState: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(
    () => ({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn(() => ({
            doc: vi.fn(() => ({
              collection: vi.fn(() => ({
                doc: vi.fn(() => ({
                  set: mockSet,
                })),
              })),
            })),
          })),
        })),
      })),
    }),
    {
      FieldValue: {
        serverTimestamp: mockServerTimestamp,
        delete: mockDelete,
        increment: mockIncrement,
      },
    },
  ),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: mockServerTimestamp,
    delete: mockDelete,
    increment: mockIncrement,
  },
}));

vi.mock('firebase-functions/logger', () => ({
  warn: vi.fn(),
}));

vi.mock('../shared/user-deletion-guard', () => {
  class MockUserDeletionGuardReadError extends Error {
    readonly name = 'UserDeletionGuardReadError';
    readonly code = 'unavailable';
    readonly statusCode = 503;

    constructor(
      public readonly uid: string,
      public readonly phase: string,
      public readonly originalError: unknown,
    ) {
      super(`Could not read deletion guard for user ${uid} during ${phase}.`);
    }
  }

  return {
    getUserDeletionGuardState: mockGetUserDeletionGuardState,
    UserDeletionGuardReadError: MockUserDeletionGuardReadError,
  };
});

import {
  setActivitySyncProcessingMetadata,
  setActivitySyncRequeuedMetadata,
  setActivitySyncSkippedMetadata,
  setActivitySyncSuccessMetadata,
} from './metadata';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { ServiceNames } from '@sports-alliance/sports-lib';

describe('activity-sync/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserDeletionGuardState.mockResolvedValue({
      userExists: true,
      deletionInProgress: false,
      shouldSkip: false,
    });
  });

  it('clears stale skip/error detail fields when setting success metadata', async () => {
    await setActivitySyncSuccessMetadata({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      manual: false,
      destinationUploadID: 'upload-1',
      workoutKey: 'workout-1',
      infoCode: 'ALREADY_EXISTS',
    });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      lastError: '__delete__',
      skippedReason: '__delete__',
      detail: '__delete__',
      destinationUploadID: 'upload-1',
      workoutKey: 'workout-1',
      infoCode: 'ALREADY_EXISTS',
    }), { merge: true });
  });

  it('clears stale lastError when setting skipped metadata', async () => {
    await setActivitySyncSkippedMetadata({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      manual: true,
      skippedReason: 'unsupported_original_file',
      detail: 'No FIT file found.',
    });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      skippedReason: 'unsupported_original_file',
      detail: 'No FIT file found.',
      lastError: '__delete__',
    }), { merge: true });
  });

  it('writes queued state without resetting attempts when re-queueing metadata', async () => {
    await setActivitySyncRequeuedMetadata({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      manual: true,
    });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued',
      lastError: '__delete__',
      skippedReason: '__delete__',
      detail: '__delete__',
    }), { merge: true });
  });

  it('does not write metadata when the user is missing or deletion is active', async () => {
    mockGetUserDeletionGuardState.mockResolvedValueOnce({
      userExists: false,
      deletionInProgress: false,
      shouldSkip: true,
    });

    await setActivitySyncProcessingMetadata({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'deleted-user',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      manual: false,
    });

    expect(mockSet).not.toHaveBeenCalled();
  });

  it('surfaces deletion-guard read failures as retryable unavailable errors', async () => {
    mockGetUserDeletionGuardState.mockRejectedValueOnce(new Error('read failed'));

    await expect(setActivitySyncProcessingMetadata({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      userID: 'user-1',
      eventID: 'event-1',
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
      manual: false,
    })).rejects.toMatchObject({
      name: 'UserDeletionGuardReadError',
      code: 'unavailable',
      statusCode: 503,
    });
  });
});
