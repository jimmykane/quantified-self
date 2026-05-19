import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS } from '../../../shared/activity-sync-routes';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';

const {
  mockTokenGet,
  mockDownload,
  mockUpdateToProcessed,
  mockIncreaseRetryCountForQueueItem,
  mockMoveToDeadLetterQueue,
  mockGetActivitySyncRouteAllowlistConfigError,
  mockIsActivitySyncRouteUserAllowlisted,
  mockIsActivitySyncRouteEnabledForUser,
  mockSetActivitySyncProcessingMetadata,
  mockSetActivitySyncSuccessMetadata,
  mockSetActivitySyncSkippedMetadata,
  mockSetActivitySyncRetryingMetadata,
  mockSetActivitySyncFailedMetadata,
  mockToActivitySyncMetadataError,
  mockUploadActivityFileToSuunto,
  mockHasProAccess,
  mockIsServiceReconnectRequiredForUser,
  mockShouldSkipQueueWorkForDeletedUser,
  mockMarkQueueItemSkipped,
} = vi.hoisted(() => {
  const mockTokenGet = vi.fn();
  const mockDownload = vi.fn();

  return {
    mockTokenGet,
    mockDownload,
    mockUpdateToProcessed: vi.fn(),
    mockIncreaseRetryCountForQueueItem: vi.fn(),
    mockMoveToDeadLetterQueue: vi.fn(),
    mockGetActivitySyncRouteAllowlistConfigError: vi.fn(),
    mockIsActivitySyncRouteUserAllowlisted: vi.fn(),
    mockIsActivitySyncRouteEnabledForUser: vi.fn(),
    mockSetActivitySyncProcessingMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncSuccessMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncSkippedMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncRetryingMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncFailedMetadata: vi.fn().mockResolvedValue(undefined),
    mockToActivitySyncMetadataError: vi.fn((error: unknown) => ({
      code: `${(error as { code?: unknown } | undefined)?.code || 'unknown'}`,
      message: `${(error as { message?: unknown } | undefined)?.message || error}`,
      normalizedMessage: `${(error as { message?: unknown } | undefined)?.message || error}`,
    })),
    mockUploadActivityFileToSuunto: vi.fn(),
    mockHasProAccess: vi.fn(),
    mockIsServiceReconnectRequiredForUser: vi.fn(),
    mockShouldSkipQueueWorkForDeletedUser: vi.fn(),
    mockMarkQueueItemSkipped: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        collection: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: mockTokenGet,
          })),
        })),
      })),
    })),
  }),
  storage: () => ({
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({
        download: mockDownload,
      })),
    })),
  }),
}));

vi.mock('../queue-utils', () => ({
  QueueResult: {
    Processed: 'PROCESSED',
    Skipped: 'SKIPPED',
    RetryIncremented: 'RETRY_INCREMENTED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    Failed: 'FAILED',
  },
  updateToProcessed: mockUpdateToProcessed,
  markQueueItemSkipped: mockMarkQueueItemSkipped,
  increaseRetryCountForQueueItem: mockIncreaseRetryCountForQueueItem,
  moveToDeadLetterQueue: mockMoveToDeadLetterQueue,
  QUEUE_SKIPPED_REASONS: {
    UserDeletedOrDeleting: 'user_deleted_or_deleting',
    WorkerReturnedSkipped: 'worker_returned_skipped',
  },
}));

vi.mock('./settings', () => ({
  isActivitySyncRouteEnabledForUser: mockIsActivitySyncRouteEnabledForUser,
}));

vi.mock('./allowlist', () => ({
  getActivitySyncRouteAllowlistConfigError: mockGetActivitySyncRouteAllowlistConfigError,
  isActivitySyncRouteUserAllowlisted: mockIsActivitySyncRouteUserAllowlisted,
}));

vi.mock('./metadata', () => ({
  setActivitySyncProcessingMetadata: mockSetActivitySyncProcessingMetadata,
  setActivitySyncSuccessMetadata: mockSetActivitySyncSuccessMetadata,
  setActivitySyncSkippedMetadata: mockSetActivitySyncSkippedMetadata,
  setActivitySyncRetryingMetadata: mockSetActivitySyncRetryingMetadata,
  setActivitySyncFailedMetadata: mockSetActivitySyncFailedMetadata,
  toActivitySyncMetadataError: mockToActivitySyncMetadataError,
}));

vi.mock('../suunto/activities', () => ({
  uploadActivityFileToSuunto: mockUploadActivityFileToSuunto,
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    hasProAccess: mockHasProAccess,
  };
});

vi.mock('../service-connection-meta', () => ({
  isServiceReconnectRequiredForUser: mockIsServiceReconnectRequiredForUser,
}));

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: mockShouldSkipQueueWorkForDeletedUser,
}));

import { processActivitySyncQueueItem } from './process-queue-item';
import { QueueResult } from '../queue-utils';

const baseQueueItem: ActivitySyncQueueItemInterface = {
  id: 'sync-item-1',
  dateCreated: Date.now(),
  processed: false as const,
  retryCount: 0,
  totalRetryCount: 0,
  errors: [],
  dispatchedToCloudTask: null,
  routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
  sourceServiceName: ServiceNames.GarminAPI,
  destinationServiceName: ServiceNames.SuuntoApp,
  userID: 'user-1',
  eventID: 'event-1',
  sourceActivityID: 'activity-1',
  manual: false,
  originalFile: {
    path: 'users/user-1/events/event-1/original.fit',
    extension: 'fit',
  },
};

describe('activity-sync/process-queue-item', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue(null);
    mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(true);
    mockHasProAccess.mockResolvedValue(true);
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(true);
    mockIsServiceReconnectRequiredForUser.mockResolvedValue(false);
    mockTokenGet.mockResolvedValue({ size: 1 });
    mockDownload.mockResolvedValue([Buffer.from('FITDATA')]);
    mockUploadActivityFileToSuunto.mockResolvedValue({
      status: 'success',
      message: 'ok',
      uploadId: 'upload-1',
      workoutKey: 'workout-1',
    });
    mockUpdateToProcessed.mockResolvedValue(QueueResult.Processed);
    mockMarkQueueItemSkipped.mockResolvedValue(QueueResult.Processed);
    mockIncreaseRetryCountForQueueItem.mockResolvedValue(QueueResult.RetryIncremented);
    mockMoveToDeadLetterQueue.mockResolvedValue(QueueResult.MovedToDLQ);
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
  });

  it('marks queue item processed and writes success metadata when upload succeeds', async () => {
    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncProcessingMetadata).toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledWith('user-1', Buffer.from('FITDATA'));
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      destinationUploadID: 'upload-1',
      workoutKey: 'workout-1',
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({
      destinationUploadID: 'upload-1',
      destinationWorkoutKey: 'workout-1',
      resultStatus: 'success',
      successProcessedAt: expect.any(Number),
    }));
  });

  it('retries instead of DLQ when the deletion guard cannot be read', async () => {
    mockShouldSkipQueueWorkForDeletedUser.mockRejectedValueOnce(Object.assign(
      new Error('guard read failed'),
      {
        name: 'UserDeletionGuardReadError',
        code: 'unavailable',
        statusCode: 503,
      },
    ));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      baseQueueItem,
      expect.objectContaining({
        name: 'UserDeletionGuardReadError',
        code: 'unavailable',
      }),
      1,
      undefined,
    );
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('marks queue item skipped without metadata or upload when account deletion is active', async () => {
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      'user_deleted_or_deleting',
      expect.objectContaining({
        skippedContext: 'USER_DELETION_GUARD',
      }),
    );
    expect(mockSetActivitySyncProcessingMetadata).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('rechecks account deletion before upload and skips queued work if deletion starts mid-run', async () => {
    mockShouldSkipQueueWorkForDeletedUser
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      'user_deleted_or_deleting',
      expect.objectContaining({
        skippedContext: 'USER_DELETION_GUARD',
      }),
    );
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('skips and marks processed when user is not allowlisted for route', async () => {
    mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(false);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncProcessingMetadata).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'user_not_allowlisted',
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({
      skippedReason: 'user_not_allowlisted',
      resultStatus: 'skipped',
    }));
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('skips and marks processed when allowlist is misconfigured', async () => {
    mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue('allowlist misconfigured');

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncProcessingMetadata).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'allowlist_misconfigured',
      detail: 'allowlist misconfigured',
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({
      skippedReason: 'allowlist_misconfigured',
    }));
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('treats ALREADY_EXISTS destination response as success', async () => {
    mockUploadActivityFileToSuunto.mockResolvedValue({
      status: 'info',
      code: 'ALREADY_EXISTS',
      message: 'exists',
      uploadId: 'upload-existing',
    });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      infoCode: 'ALREADY_EXISTS',
      destinationUploadID: 'upload-existing',
    }));
  });

  it('skips and marks processed when original file extension is unsupported', async () => {
    const unsupportedOriginalFileQueueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      originalFile: { path: 'users/user-1/events/event-1/original.tcx', extension: 'tcx' },
    };
    const result = await processActivitySyncQueueItem(unsupportedOriginalFileQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'unsupported_original_file',
    }));
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('skips and marks processed when route is disabled at worker time', async () => {
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('skips and marks processed when destination service requires reconnect even if a token remains', async () => {
    mockIsServiceReconnectRequiredForUser.mockResolvedValue(true);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockTokenGet).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'destination_not_connected',
      detail: 'Destination account is not connected.',
    }));
    expect(mockUpdateToProcessed).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({
      skippedReason: 'destination_not_connected',
      resultStatus: 'skipped',
    }));
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('processes manual queue items when route is disabled at worker time', async () => {
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);
    const manualQueueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      manual: true,
    };

    const result = await processActivitySyncQueueItem(manualQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledWith('user-1', Buffer.from('FITDATA'));
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalled();
  });

  it('increments retry for transient upload failures', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue({ statusCode: 503, message: 'temporarily unavailable' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalled();
  });

  it('increments retry for transient upload failures with numeric gRPC code', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue({ code: 14, message: 'service unavailable' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalled();
  });

  it('increments retry for transient pre-check failures with numeric gRPC status', async () => {
    mockHasProAccess.mockRejectedValue({ status: 4, message: 'deadline exceeded' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
    }));
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalled();
  });

  it('increments retry for transient pre-check failures before upload', async () => {
    mockHasProAccess.mockRejectedValue({ statusCode: 503, message: 'auth store unavailable' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
    }));
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalled();
  });

  it('moves to DLQ for non-transient numeric gRPC codes', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue({ code: 9, message: 'failed precondition' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncFailedMetadata).toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalled();
  });

  it('moves to DLQ for permanent pre-check failures before upload', async () => {
    mockHasProAccess.mockRejectedValue(new Error('permission graph exploded'));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockSetActivitySyncFailedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
    }));
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalled();
  });

  it('moves to DLQ for permanent failures', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue(new Error('permanent failure'));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncFailedMetadata).toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalled();
  });
});
