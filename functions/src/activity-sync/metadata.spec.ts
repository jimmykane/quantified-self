import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSet,
  mockServerTimestamp,
  mockDelete,
  mockIncrement,
} = vi.hoisted(() => ({
  mockSet: vi.fn().mockResolvedValue(undefined),
  mockServerTimestamp: vi.fn(() => '__server_timestamp__'),
  mockDelete: vi.fn(() => '__delete__'),
  mockIncrement: vi.fn((value: number) => `__increment_${value}__`),
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

import {
  setActivitySyncRequeuedMetadata,
  setActivitySyncSkippedMetadata,
  setActivitySyncSuccessMetadata,
} from './metadata';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { ServiceNames } from '@sports-alliance/sports-lib';

describe('activity-sync/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
