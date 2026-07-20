import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { ACTIVITY_SYNC_ROUTE_IDS, ACTIVITY_SYNC_ROUTES } from '../../../shared/activity-sync-routes';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';

const {
  mockTokenGet,
  mockDownload,
  mockUpdateToProcessed,
  mockDeferQueueItemForPendingDisconnect,
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
  mockUploadActivityFileToWahoo,
  mockGetWahooActivityUploadStatus,
  mockHasProAccess,
  mockGetServiceConnectionMeta,
  mockShouldSkipQueueWorkForDeletedUser,
  mockMarkQueueItemSkipped,
  mockUpdateQueueItemIfUserActive,
} = vi.hoisted(() => {
  const mockTokenGet = vi.fn();
  const mockDownload = vi.fn();

  return {
    mockTokenGet,
    mockDownload,
    mockUpdateToProcessed: vi.fn(),
    mockDeferQueueItemForPendingDisconnect: vi.fn(),
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
    mockUploadActivityFileToWahoo: vi.fn(),
    mockGetWahooActivityUploadStatus: vi.fn(),
    mockHasProAccess: vi.fn(),
    mockGetServiceConnectionMeta: vi.fn(),
    mockShouldSkipQueueWorkForDeletedUser: vi.fn(),
    mockMarkQueueItemSkipped: vi.fn(),
    mockUpdateQueueItemIfUserActive: vi.fn(),
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
    Deferred: 'DEFERRED',
    RetryIncremented: 'RETRY_INCREMENTED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    Failed: 'FAILED',
  },
  updateToProcessed: mockUpdateToProcessed,
  deferQueueItemForPendingDisconnect: mockDeferQueueItemForPendingDisconnect,
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

vi.mock('../wahoo/activities', () => ({
  uploadActivityFileToWahoo: mockUploadActivityFileToWahoo,
  getWahooActivityUploadStatus: mockGetWahooActivityUploadStatus,
}));

vi.mock('../utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils')>();
  return {
    ...actual,
    hasProAccess: mockHasProAccess,
  };
});

vi.mock('../service-connection-meta', () => ({
  getServiceConnectionMeta: mockGetServiceConnectionMeta,
}));

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: mockShouldSkipQueueWorkForDeletedUser,
}));

vi.mock('../queue/dispatch-marker', () => ({
  QueueItemUserGuardedUpdateResult: {
    Updated: 'updated',
    SkippedDeletedUser: 'skipped_deleted_user',
  },
  updateQueueItemIfUserActive: mockUpdateQueueItemIfUserActive,
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
    mockGetServiceConnectionMeta.mockResolvedValue(null);
    mockTokenGet.mockResolvedValue({ size: 1 });
    mockDownload.mockResolvedValue([Buffer.from('FITDATA')]);
    mockUploadActivityFileToSuunto.mockResolvedValue({
      status: 'success',
      message: 'ok',
      uploadId: 'upload-1',
      workoutKey: 'workout-1',
    });
    mockUploadActivityFileToWahoo.mockResolvedValue({
      status: 'success',
      message: 'ok',
      uploadId: 'wahoo-upload-1',
      workoutKey: 'wahoo-workout-1',
    });
    mockGetWahooActivityUploadStatus.mockResolvedValue({
      status: 'success',
      message: 'ok',
      uploadId: 'wahoo-upload-1',
      workoutKey: 'wahoo-workout-1',
    });
    mockUpdateToProcessed.mockResolvedValue(QueueResult.Processed);
    mockDeferQueueItemForPendingDisconnect.mockResolvedValue(QueueResult.Deferred);
    mockMarkQueueItemSkipped.mockResolvedValue(QueueResult.Processed);
    mockIncreaseRetryCountForQueueItem.mockResolvedValue(QueueResult.RetryIncremented);
    mockMoveToDeadLetterQueue.mockResolvedValue(QueueResult.MovedToDLQ);
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
    mockUpdateQueueItemIfUserActive.mockResolvedValue('updated');
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

  it('persists a pending Wahoo upload token and retries status checks without posting the FIT file again', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: {} as any,
    };
    mockUploadActivityFileToWahoo.mockResolvedValueOnce({
      status: 'pending',
      message: 'processing',
      uploadId: 'wahoo-upload-1',
    });

    const firstResult = await processActivitySyncQueueItem(queueItem);

    expect(firstResult).toBe(QueueResult.RetryIncremented);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledWith('user-1', Buffer.from('FITDATA'), expect.objectContaining({
      filename: 'original.fit',
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItemDocument: queueItem.ref,
      queueItemId: queueItem.id,
      userID: queueItem.userID,
      phase: 'before_activity_sync_wahoo_pending_upload_persist',
      updateData: expect.objectContaining({ destinationUploadID: 'wahoo-upload-1' }),
    }));
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({ code: 'deadline-exceeded' }),
      1,
      undefined,
    );

    await processActivitySyncQueueItem(queueItem);

    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith('user-1', 'wahoo-upload-1');
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
  });

  it('does not persist a Wahoo upload token after account deletion begins', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: {} as any,
    };
    mockUploadActivityFileToWahoo.mockResolvedValueOnce({
      status: 'pending',
      message: 'processing',
      uploadId: 'wahoo-upload-1',
    });
    mockUpdateQueueItemIfUserActive.mockResolvedValueOnce('skipped_deleted_user');

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(queueItem.destinationUploadID).toBeUndefined();
    expect(mockMarkQueueItemSkipped).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
  });

  it('skips Wahoo delivery when the saved OAuth grant lacks workout write scope', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(Object.assign(
      new Error('Reconnect Wahoo and allow workout access.'),
      { name: 'WahooWorkoutWriteScopeRequiredError', code: 'failed-precondition' },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'destination_write_scope_missing',
    }));
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
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

  it('rechecks account deletion after downloading and before destination upload', async () => {
    mockShouldSkipQueueWorkForDeletedUser
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockDownload).toHaveBeenCalled();
    expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      'user_deleted_or_deleting',
      expect.objectContaining({
        skippedContext: 'USER_DELETION_GUARD',
      }),
    );
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
    mockGetServiceConnectionMeta.mockImplementation(async (_userID: string, serviceName: ServiceNames) => (
      serviceName === ServiceNames.SuuntoApp
        ? { connectionState: 'reconnect_required' }
        : null
    ));

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

  it('defers instead of marking processed when destination service is pending disconnect', async () => {
    mockGetServiceConnectionMeta.mockImplementation(async (_userID: string, serviceName: ServiceNames) => (
      serviceName === ServiceNames.SuuntoApp
        ? { connectionState: 'disconnect_pending' }
        : null
    ));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockTokenGet).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'destination_not_connected',
    }));
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalled();
    expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      expect.objectContaining({
        deferredServiceName: `${ServiceNames.SuuntoApp}`,
      }),
    );
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('defers an enabled Wahoo route when its source service is pending disconnect', async () => {
    const route = ACTIVITY_SYNC_ROUTES[ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI];
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockGetServiceConnectionMeta.mockImplementation(async (_userID: string, serviceName: ServiceNames) => (
      serviceName === route.sourceServiceName
        ? { connectionState: 'disconnect_pending' }
        : null
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(mockGetServiceConnectionMeta).toHaveBeenCalledWith(queueItem.userID, route.sourceServiceName);
    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(
      queueItem,
      undefined,
      expect.objectContaining({
        deferredServiceName: `${route.sourceServiceName}`,
      }),
    );
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
  });

  it('defers route-disabled work when route was disabled by pending disconnect', async () => {
    const route = ACTIVITY_SYNC_ROUTES[baseQueueItem.routeId];
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);
    mockGetServiceConnectionMeta.mockResolvedValue({ connectionState: 'disconnect_pending' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockGetServiceConnectionMeta).toHaveBeenCalledWith(baseQueueItem.userID, route.sourceServiceName);
    expect(mockGetServiceConnectionMeta).toHaveBeenCalledWith(baseQueueItem.userID, route.destinationServiceName);
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
    expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      expect.objectContaining({
        deferredServiceName: `${route.sourceServiceName}`,
      }),
    );
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
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

  it('marks processed as skipped when destination upload detects account deletion during token refresh', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(Object.assign(new Error('deleted'), {
      name: 'TokenRefreshSkippedForDeletedUserError',
    }));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncFailedMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      'user_deleted_or_deleting',
      expect.objectContaining({
        skippedContext: 'USER_DELETION_GUARD',
      }),
    );
  });

  it('marks processed as skipped when destination upload detects deletion before remote Suunto calls', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(Object.assign(new Error('deleted before upload'), {
      name: 'SuuntoActivityUploadSkippedForDeletedUserError',
      code: 'user_deleted_or_deleting',
    }));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncFailedMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      'user_deleted_or_deleting',
      expect.objectContaining({
        skippedContext: 'USER_DELETION_GUARD',
      }),
    );
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
