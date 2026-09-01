import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as logger from 'firebase-functions/logger';
import { ACTIVITY_SYNC_ROUTE_IDS, ACTIVITY_SYNC_ROUTES } from '../../../shared/activity-sync-routes';
import { ActivitySyncQueueItemInterface } from '../queue/queue-item.interface';
import { ProviderOperationError } from '../shared/provider-operation-error';

type MockActivitySyncQueueItemRef = NonNullable<ActivitySyncQueueItemInterface['ref']>;

interface MockActivitySyncRetryParams {
  queueItem: ActivitySyncQueueItemInterface;
  error: Error;
  incrementBy?: number;
  bulkWriter?: unknown;
  maxRetryDlqContext?: string;
  retryDispatchMarkerAtMs?: (nextRetryCount: number) => number | null;
}

interface MockActivitySyncDlqParams {
  queueItem: ActivitySyncQueueItemInterface;
  error: Error;
  bulkWriter?: unknown;
  context?: string;
}

function createMockActivitySyncQueueItemRef(): MockActivitySyncQueueItemRef {
  return {} as unknown as MockActivitySyncQueueItemRef;
}

const {
  mockTokenGet,
  mockEventGet,
  mockDownload,
  mockUpdateToProcessed,
  mockDeferQueueItemForPendingDisconnect,
  mockDeferQueueItemForPendingDisconnectIfCurrentUserActive,
  mockDeferQueueItemForReconnectRequiredIfCurrentUserActive,
  mockIncreaseRetryCountForQueueItem,
  mockIncreaseRetryCountIfCurrentParams,
  mockMoveToDeadLetterQueue,
  mockMoveToDeadLetterQueueIfCurrentParams,
  mockGetActivitySyncRouteAllowlistConfigError,
  mockIsActivitySyncRouteUserAllowlisted,
  mockIsActivitySyncRouteEnabledForUser,
  mockSetActivitySyncProcessingMetadata,
  mockSetActivitySyncSuccessMetadata,
  mockSetActivitySyncSkippedMetadata,
  mockSetActivitySyncRetryingMetadata,
  mockSetActivitySyncRetryingMetadataIfQueueItemDeferred,
  mockSetActivitySyncFailedMetadata,
  mockToActivitySyncMetadataError,
  mockUploadActivityFileToSuunto,
  mockGetSuuntoActivityUploadStatus,
  mockResumeSuuntoActivityBlobUpload,
  mockRecordSuccessfulSuuntoActivityUploadForQueueItem,
  mockUploadActivityFileToWahoo,
  mockGetWahooActivityUploadStatus,
  mockUploadActivityFileToCOROS,
  mockGetCOROSActivityUploadStatus,
  mockGetActiveCOROSTokenSnapshot,
  mockHasProAccess,
  mockGetServiceConnectionMeta,
  mockShouldSkipQueueWorkForDeletedUser,
  mockMarkQueueItemSkipped,
  mockUpdateQueueItemIfUserActive,
  mockFieldValueDelete,
  mockRecordActivitySyncOutboundFingerprint,
  mockIsWahooReconnectRequiredError,
  mockFinalizeDisabledSyncRouteIfCurrent,
} = vi.hoisted(() => {
  const mockTokenGet = vi.fn();
  const mockDownload = vi.fn();

  return {
    mockTokenGet,
    mockEventGet: vi.fn(),
    mockDownload,
    mockUpdateToProcessed: vi.fn(),
    mockDeferQueueItemForPendingDisconnect: vi.fn(),
    mockDeferQueueItemForPendingDisconnectIfCurrentUserActive: vi.fn(),
    mockDeferQueueItemForReconnectRequiredIfCurrentUserActive: vi.fn(),
    mockIncreaseRetryCountForQueueItem: vi.fn(),
    mockIncreaseRetryCountIfCurrentParams: vi.fn(),
    mockMoveToDeadLetterQueue: vi.fn(),
    mockMoveToDeadLetterQueueIfCurrentParams: vi.fn(),
    mockGetActivitySyncRouteAllowlistConfigError: vi.fn(),
    mockIsActivitySyncRouteUserAllowlisted: vi.fn(),
    mockIsActivitySyncRouteEnabledForUser: vi.fn(),
    mockSetActivitySyncProcessingMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncSuccessMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncSkippedMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncRetryingMetadata: vi.fn().mockResolvedValue(undefined),
    mockSetActivitySyncRetryingMetadataIfQueueItemDeferred: vi.fn().mockResolvedValue(true),
    mockSetActivitySyncFailedMetadata: vi.fn().mockResolvedValue(undefined),
    mockToActivitySyncMetadataError: vi.fn((error: unknown) => ({
      code: `${(error as { code?: unknown } | undefined)?.code || 'unknown'}`,
      message: `${(error as { message?: unknown } | undefined)?.message || error}`,
      normalizedMessage: `${(error as { message?: unknown } | undefined)?.message || error}`,
    })),
    mockUploadActivityFileToSuunto: vi.fn(),
    mockGetSuuntoActivityUploadStatus: vi.fn(),
    mockResumeSuuntoActivityBlobUpload: vi.fn(),
    mockRecordSuccessfulSuuntoActivityUploadForQueueItem: vi.fn(),
    mockUploadActivityFileToWahoo: vi.fn(),
    mockGetWahooActivityUploadStatus: vi.fn(),
    mockUploadActivityFileToCOROS: vi.fn(),
    mockGetCOROSActivityUploadStatus: vi.fn(),
    mockGetActiveCOROSTokenSnapshot: vi.fn(),
    mockHasProAccess: vi.fn(),
    mockGetServiceConnectionMeta: vi.fn(),
    mockShouldSkipQueueWorkForDeletedUser: vi.fn(),
    mockMarkQueueItemSkipped: vi.fn(),
    mockUpdateQueueItemIfUserActive: vi.fn(),
    mockFieldValueDelete: Symbol('FIELD_VALUE_DELETE'),
    mockRecordActivitySyncOutboundFingerprint: vi.fn(),
    mockIsWahooReconnectRequiredError: vi.fn(),
    mockFinalizeDisabledSyncRouteIfCurrent: vi.fn(),
  };
});

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn(() => ({
        collection: vi.fn((nestedCollectionName: string) => (
          collectionName === 'users' && nestedCollectionName === 'events'
            ? { doc: vi.fn(() => ({ get: mockEventGet })) }
            : {
              limit: vi.fn(() => ({
                get: mockTokenGet,
              })),
            }
        )),
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

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: vi.fn(() => mockFieldValueDelete),
  },
}));

vi.mock('../queue-utils', () => ({
  PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER: Number.MAX_SAFE_INTEGER - 1,
  ProviderOperationStillInFlightError: class ProviderOperationStillInFlightError extends Error {
    constructor(
      public readonly queueItemId: string,
      public readonly providerOperationStartedAt: number,
    ) {
      super(`Provider operation for queue item ${queueItemId} is still in flight.`);
    }
  },
  isProviderOperationInFlightLeaseActive: (queueItem: Pick<ActivitySyncQueueItemInterface, 'dispatchedToCloudTask' | 'providerOperationStartedAt'>) => (
    queueItem.dispatchedToCloudTask === Number.MAX_SAFE_INTEGER - 1
    && Number(queueItem.providerOperationStartedAt) > Date.now() - 12 * 60 * 1000
  ),
  QueueResult: {
    Processed: 'PROCESSED',
    Skipped: 'SKIPPED',
    Deferred: 'DEFERRED',
    ProviderStatusPending: 'PROVIDER_STATUS_PENDING',
    RetryIncremented: 'RETRY_INCREMENTED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    Failed: 'FAILED',
  },
  updateToProcessed: mockUpdateToProcessed,
  deferQueueItemForPendingDisconnect: mockDeferQueueItemForPendingDisconnect,
  deferQueueItemForPendingDisconnectIfCurrentUserActive: mockDeferQueueItemForPendingDisconnectIfCurrentUserActive,
  deferQueueItemForReconnectRequiredIfCurrentUserActive: mockDeferQueueItemForReconnectRequiredIfCurrentUserActive,
  markQueueItemSkipped: mockMarkQueueItemSkipped,
  increaseRetryCountForQueueItem: mockIncreaseRetryCountForQueueItem,
  increaseRetryCountIfCurrentUserActive: async (params: MockActivitySyncRetryParams) => {
    mockIncreaseRetryCountIfCurrentParams(params);
    const args = [params.queueItem, params.error, params.incrementBy, params.bulkWriter];
    if (params.maxRetryDlqContext !== undefined) {
      args.push(params.maxRetryDlqContext);
    }
    const result = await mockIncreaseRetryCountForQueueItem(...args);
    if (result === 'RETRY_INCREMENTED') {
      const currentRetryCount = Number(params.queueItem.retryCount);
      const nextRetryCount = (Number.isFinite(currentRetryCount)
        ? Math.max(0, Math.floor(currentRetryCount))
        : 0) + (params.incrementBy || 1);
      params.queueItem.dispatchedToCloudTask = null;
      if (params.retryDispatchMarkerAtMs) {
        params.queueItem.dispatchedToCloudTask = params.retryDispatchMarkerAtMs(nextRetryCount);
      }
      params.queueItem.providerOperationStartedAt = null;
    }
    return result;
  },
  moveToDeadLetterQueue: mockMoveToDeadLetterQueue,
  moveToDeadLetterQueueIfCurrentUserActive: (params: MockActivitySyncDlqParams) => {
    mockMoveToDeadLetterQueueIfCurrentParams(params);
    return mockMoveToDeadLetterQueue(
      params.queueItem,
      params.error,
      params.bulkWriter,
      params.context,
    );
  },
  QUEUE_SKIPPED_REASONS: {
    UserDeletedOrDeleting: 'user_deleted_or_deleting',
    WorkerReturnedSkipped: 'worker_returned_skipped',
  },
  QUEUE_DEFERRED_REASONS: {
    ServiceDisconnectPending: 'service_disconnect_pending',
    ServiceReconnectRequired: 'service_reconnect_required',
  },
}));
vi.mock('../queue/sync-route-eligibility', () => ({
  DisabledSyncRouteTransitionResult: {
    Enabled: 'enabled',
    DeferredForRestore: 'deferred_for_restore',
    DisconnectPending: 'disconnect_pending',
    ReconnectRequired: 'reconnect_required',
    ProcessedAsDisabled: 'processed_as_disabled',
    NotCurrent: 'not_current',
    SkippedDeletedUser: 'skipped_deleted_user',
  },
  finalizeDisabledSyncRouteIfCurrent: mockFinalizeDisabledSyncRouteIfCurrent,
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
  setActivitySyncRetryingMetadataIfQueueItemDeferred: mockSetActivitySyncRetryingMetadataIfQueueItemDeferred,
  setActivitySyncFailedMetadata: mockSetActivitySyncFailedMetadata,
  toActivitySyncMetadataError: mockToActivitySyncMetadataError,
}));

vi.mock('../suunto/activities', () => ({
  uploadActivityFileToSuunto: mockUploadActivityFileToSuunto,
  getSuuntoActivityUploadStatus: mockGetSuuntoActivityUploadStatus,
  resumeSuuntoActivityBlobUpload: mockResumeSuuntoActivityBlobUpload,
  recordSuccessfulSuuntoActivityUploadForQueueItem: mockRecordSuccessfulSuuntoActivityUploadForQueueItem,
  SuuntoActivityUploadStatePersistenceSkippedError: class SuuntoActivityUploadStatePersistenceSkippedError extends Error {},
  SuuntoActivityUploadStatePersistenceError: class SuuntoActivityUploadStatePersistenceError extends Error {
    public readonly name = 'SuuntoActivityUploadStatePersistenceError';

    constructor(
      public readonly originalError: unknown,
      public readonly uploadId: string,
      public readonly providerUserId: string,
    ) {
      super('Could not persist Suunto activity upload state before sending the activity blob.');
    }
  },
}));

vi.mock('../wahoo/activities', () => ({
  uploadActivityFileToWahoo: mockUploadActivityFileToWahoo,
  getWahooActivityUploadStatus: mockGetWahooActivityUploadStatus,
}));

vi.mock('../wahoo/refresh-recovery', () => ({
  isWahooReconnectRequiredError: mockIsWahooReconnectRequiredError,
}));

vi.mock('../coros/activities', () => ({
  uploadActivityFileToCOROS: mockUploadActivityFileToCOROS,
  getCOROSActivityUploadStatus: mockGetCOROSActivityUploadStatus,
}));

vi.mock('../coros/account', () => ({
  getActiveCOROSTokenSnapshot: mockGetActiveCOROSTokenSnapshot,
}));

vi.mock('./outbound-fingerprint', () => ({
  recordActivitySyncOutboundFingerprint: mockRecordActivitySyncOutboundFingerprint,
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
    NotCurrent: 'not_current',
  },
  updateQueueItemIfUserActive: mockUpdateQueueItemIfUserActive,
}));

import { processActivitySyncQueueItem } from './process-queue-item';
import {
  PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
  QueueResult,
} from '../queue-utils';
import { SuuntoActivityUploadStatePersistenceError } from '../suunto/activities';

const baseQueueItem: ActivitySyncQueueItemInterface = {
  id: 'sync-item-1',
  dateCreated: Date.now(),
  processed: false as const,
  retryCount: 0,
  totalRetryCount: 0,
  errors: [],
  dispatchedToCloudTask: null,
  ref: createMockActivitySyncQueueItemRef(),
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
    baseQueueItem.ref = createMockActivitySyncQueueItemRef();
    baseQueueItem.dispatchedToCloudTask = null;
    delete baseQueueItem.providerOperationStartedAt;
    delete baseQueueItem.destinationUploadID;
    delete baseQueueItem.destinationProviderUserID;
    delete baseQueueItem.destinationWorkoutKey;
    delete baseQueueItem.destinationInfoCode;
    delete baseQueueItem.destinationExpectedWorkoutTypeID;
    delete baseQueueItem.destinationUploadCountedID;
    delete baseQueueItem.destinationUploadCountedAt;
    delete baseQueueItem.destinationUploadContinuation;
    baseQueueItem.outboundFingerprintID = 'exact-v1-existing';
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
      providerUserId: 'suunto-user-1',
      workoutKey: 'workout-1',
    });
    mockGetSuuntoActivityUploadStatus.mockResolvedValue({
      status: 'success',
      message: 'ok',
      uploadId: 'upload-1',
      providerUserId: 'suunto-user-1',
      workoutKey: 'workout-1',
    });
    mockResumeSuuntoActivityBlobUpload.mockResolvedValue({
      status: 'success',
      message: 'ok',
      uploadId: 'upload-1',
      providerUserId: 'suunto-user-1',
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
    mockUploadActivityFileToCOROS.mockResolvedValue({
      status: 'pending',
      message: 'processing',
      uploadId: '9223372036854775806',
      providerUserId: 'coros-user-1',
    });
    mockGetCOROSActivityUploadStatus.mockResolvedValue({
      status: 'success',
      message: 'ok',
      uploadId: '9223372036854775806',
      providerUserId: 'coros-user-1',
    });
    mockGetActiveCOROSTokenSnapshot.mockResolvedValue({ id: 'coros-user-1' });
    mockUpdateToProcessed.mockResolvedValue(QueueResult.Processed);
    mockRecordSuccessfulSuuntoActivityUploadForQueueItem.mockResolvedValue(undefined);
    mockDeferQueueItemForPendingDisconnect.mockResolvedValue(QueueResult.Deferred);
    mockDeferQueueItemForPendingDisconnectIfCurrentUserActive.mockResolvedValue(QueueResult.Deferred);
    mockDeferQueueItemForReconnectRequiredIfCurrentUserActive.mockResolvedValue(QueueResult.Deferred);
    mockIsWahooReconnectRequiredError.mockReturnValue(false);
    mockFinalizeDisabledSyncRouteIfCurrent.mockResolvedValue({ result: 'processed_as_disabled' });
    mockMarkQueueItemSkipped.mockResolvedValue(QueueResult.Processed);
    mockIncreaseRetryCountForQueueItem.mockResolvedValue(QueueResult.RetryIncremented);
    mockMoveToDeadLetterQueue.mockResolvedValue(QueueResult.MovedToDLQ);
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
    mockUpdateQueueItemIfUserActive.mockReset().mockResolvedValue('updated');
    mockRecordActivitySyncOutboundFingerprint.mockResolvedValue({
      exactFingerprintId: 'exact-v1-new',
      fingerprintIds: ['exact-v1-new', 'semantic-v1-new'],
    });
    mockEventGet.mockResolvedValue({
      exists: true,
      data: () => ({ stats: { 'Activity Types': ['Hiking'] } }),
    });
  });

  it('persists provider-echo fingerprints before starting a new destination upload', async () => {
    delete baseQueueItem.outboundFingerprintID;

    await processActivitySyncQueueItem(baseQueueItem);

    expect(mockRecordActivitySyncOutboundFingerprint).toHaveBeenCalledWith({
      userID: 'user-1',
      destinationServiceName: ServiceNames.SuuntoApp,
      fileBuffer: Buffer.from('FITDATA'),
    });
    const markerCall = mockUpdateQueueItemIfUserActive.mock.calls.find(
      ([params]) => params.phase === 'before_activity_sync_outbound_fingerprint_marker',
    );
    expect(markerCall?.[0]).toEqual(expect.objectContaining({
      updateData: { outboundFingerprintID: 'exact-v1-new' },
    }));
    expect(mockRecordActivitySyncOutboundFingerprint.mock.invocationCallOrder[0])
      .toBeLessThan(mockUploadActivityFileToSuunto.mock.invocationCallOrder[0]);
  });

  it('marks queue item processed and writes success metadata when upload succeeds', async () => {
    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncProcessingMetadata).toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledWith(
      'user-1',
      Buffer.from('FITDATA'),
      expect.objectContaining({ persistUploadStateBeforeBlob: expect.any(Function) }),
    );
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_suunto_upload_state_persist',
      updateData: expect.objectContaining({
        destinationUploadID: 'upload-1',
        destinationProviderUserID: 'suunto-user-1',
      }),
    }));
    expect(mockUpdateQueueItemIfUserActive.mock.invocationCallOrder[0])
      .toBeLessThan(mockSetActivitySyncSuccessMetadata.mock.invocationCallOrder[0]);
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      destinationUploadID: 'upload-1',
      workoutKey: 'workout-1',
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_success_finalize',
      updateData: expect.objectContaining({
        processed: true,
        destinationUploadID: 'upload-1',
        destinationWorkoutKey: 'workout-1',
        resultStatus: 'success',
        successProcessedAt: expect.any(Number),
      }),
    }));
    expect(mockRecordSuccessfulSuuntoActivityUploadForQueueItem).toHaveBeenCalledWith(
      'user-1',
      baseQueueItem.ref,
      'upload-1',
    );
    const claim = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_activity_sync_destination_provider_operation');
    const receipt = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_activity_sync_suunto_upload_state_persist');
    const finalization = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_activity_sync_success_finalize');
    const providerOperationStartedAt = claim?.updateData.providerOperationStartedAt;
    expect(providerOperationStartedAt).toEqual(expect.any(Number));
    expect(claim?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: null,
      providerOperationStartedAt: undefined,
      destinationUploadID: undefined,
      destinationProviderUserID: undefined,
      destinationWorkoutKey: undefined,
      destinationInfoCode: undefined,
      destinationUploadContinuation: undefined,
    })).toBe(true);
    expect(claim?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
    })).toBe(false);
    expect(receipt?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
      destinationUploadID: undefined,
      destinationProviderUserID: undefined,
      destinationWorkoutKey: undefined,
      destinationInfoCode: undefined,
      destinationUploadContinuation: undefined,
    })).toBe(true);
    expect(receipt?.isCurrent({
      ...baseQueueItem,
      eventID: 'replacement-event',
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
    })).toBe(false);
    expect(finalization?.isCurrent({
      ...baseQueueItem,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
      destinationUploadID: 'upload-1',
      destinationProviderUserID: 'suunto-user-1',
      destinationUploadContinuation: null,
    })).toBe(true);
    expect(finalization?.isCurrent({
      ...baseQueueItem,
      dateCreated: baseQueueItem.dateCreated + 1,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt,
      destinationUploadID: 'upload-1',
      destinationProviderUserID: 'suunto-user-1',
      destinationUploadContinuation: null,
    })).toBe(false);
  });

  it('does not call the provider when another worker already claimed this dispatch', async () => {
    mockUpdateQueueItemIfUserActive.mockResolvedValueOnce('not_current');

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledOnce();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSuccessMetadata).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
  });

  it('persists a fresh Suunto upload ID through the guarded queue write before blob delivery continues', async () => {
    mockUploadActivityFileToSuunto.mockImplementationOnce(async (_userID, _fileBuffer, options) => {
      expect(baseQueueItem.destinationUploadID).toBeUndefined();
      const persisted = await options.persistUploadStateBeforeBlob({
        uploadId: 'pre-blob-upload',
        providerUserId: 'suunto-user-1',
        blobContinuation: {
          uploadUrl: 'https://storage.suunto.com/pre-blob-upload?signed=true',
          uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
        },
      });
      expect(persisted).toBe(true);
      expect(baseQueueItem.destinationUploadID).toBe('pre-blob-upload');
      return {
        status: 'success',
        message: 'ok',
        uploadId: 'pre-blob-upload',
        providerUserId: 'suunto-user-1',
        workoutKey: 'workout-1',
      };
    });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledTimes(3);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenNthCalledWith(1, expect.objectContaining({
      phase: 'before_activity_sync_destination_provider_operation',
      updateData: expect.objectContaining({
        dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
        providerOperationStartedAt: expect.any(Number),
      }),
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      updateData: expect.objectContaining({
        destinationUploadContinuation: {
          type: 'suunto_blob_put_v1',
          uploadUrl: 'https://storage.suunto.com/pre-blob-upload?signed=true',
          uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
        },
        dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      }),
    }));
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      destinationUploadID: 'pre-blob-upload',
    }));
  });

  it('replays the persisted Suunto signed PUT when a worker stops before blob delivery', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      destinationUploadID: 'persisted-upload-id',
      destinationProviderUserID: 'suunto-user-1',
      destinationUploadContinuation: {
        type: 'suunto_blob_put_v1',
        uploadUrl: 'https://storage.suunto.com/persisted-upload?signed=true',
        uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
      },
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };
    mockResumeSuuntoActivityBlobUpload.mockImplementationOnce(async (_userID, loadFile) => {
      expect(mockDownload).not.toHaveBeenCalled();
      await expect(loadFile()).resolves.toEqual(Buffer.from('FITDATA'));
      return {
        status: 'success',
        message: 'ok',
        uploadId: 'persisted-upload-id',
        providerUserId: 'suunto-user-1',
        workoutKey: 'workout-1',
      };
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockGetSuuntoActivityUploadStatus).not.toHaveBeenCalled();
    expect(mockResumeSuuntoActivityBlobUpload).toHaveBeenCalledWith(
      'user-1',
      expect.any(Function),
      {
        uploadId: 'persisted-upload-id',
        providerUserId: 'suunto-user-1',
        blobContinuation: {
          uploadUrl: 'https://storage.suunto.com/persisted-upload?signed=true',
          uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
        },
      },
    );
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_success_finalize',
      updateData: expect.objectContaining({ destinationUploadContinuation: null }),
    }));
  });

  it('finalizes an already-processed persisted Suunto upload without downloading its original file', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      destinationUploadID: 'processed-upload-id',
      destinationProviderUserID: 'suunto-user-1',
      destinationUploadContinuation: {
        type: 'suunto_blob_put_v1',
        uploadUrl: 'https://storage.suunto.com/processed-upload?signed=true',
        uploadHeaders: { 'x-ms-blob-type': 'BlockBlob' },
      },
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockResumeSuuntoActivityBlobUpload).toHaveBeenCalledWith(
      'user-1',
      expect.any(Function),
      expect.objectContaining({ uploadId: 'processed-upload-id' }),
    );
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('fails closed when a transient pre-blob state persistence failure follows provider initialization', async () => {
    const persistenceError = Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' });
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(
      new SuuntoActivityUploadStatePersistenceError(
        persistenceError,
        'initialized-without-state',
        'suunto-user-1',
      ),
    );

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUploadID: 'initialized-without-state',
        destinationProviderUserID: 'suunto-user-1',
      }),
      expect.objectContaining({
        code: 'internal',
      }),
      undefined,
      'DESTINATION_PROVIDER_RESUME_STATE_PERSIST_FAILED',
    );
    expect(mockMoveToDeadLetterQueueIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: {
        additionalData: expect.objectContaining({
          destinationUploadID: 'initialized-without-state',
          destinationProviderUserID: 'suunto-user-1',
          destinationUploadContinuation: null,
        }),
      },
    }));
  });

  it('moves a successful Suunto upload to DLQ when its resume identifiers cannot be persisted', async () => {
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncSuccessMetadata).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUploadID: 'upload-1',
        destinationProviderUserID: 'suunto-user-1',
      }),
      expect.objectContaining({ code: 'internal' }),
      undefined,
      'DESTINATION_PROVIDER_RESUME_STATE_PERSIST_FAILED',
    );
  });

  it('resumes a successful Suunto job when success metadata persistence fails transiently', async () => {
    mockSetActivitySyncSuccessMetadata.mockRejectedValueOnce(Object.assign(
      new Error('Firestore unavailable'),
      { code: 'unavailable' },
    ));

    const firstResult = await processActivitySyncQueueItem(baseQueueItem);

    expect(firstResult).toBe(QueueResult.RetryIncremented);
    expect(baseQueueItem.destinationUploadID).toBe('upload-1');
    expect(baseQueueItem.destinationProviderUserID).toBe('suunto-user-1');
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledTimes(1);
    expect(mockIncreaseRetryCountIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: {
        additionalData: expect.objectContaining({
          destinationUploadID: 'upload-1',
          destinationProviderUserID: 'suunto-user-1',
          destinationUploadContinuation: null,
        }),
      },
    }));

    const secondResult = await processActivitySyncQueueItem(baseQueueItem);

    expect(secondResult).toBe(QueueResult.Processed);
    expect(mockGetSuuntoActivityUploadStatus).toHaveBeenCalledWith(
      'user-1',
      'upload-1',
      'suunto-user-1',
    );
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledTimes(1);
  });

  it('retains successful Suunto resume identifiers when the final queue update fails', async () => {
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));

    const firstResult = await processActivitySyncQueueItem(baseQueueItem);

    expect(firstResult).toBe(QueueResult.Failed);
    expect(baseQueueItem.destinationUploadID).toBe('upload-1');
    expect(baseQueueItem.destinationProviderUserID).toBe('suunto-user-1');
    baseQueueItem.providerOperationStartedAt = Date.now() - 13 * 60 * 1000;

    const secondResult = await processActivitySyncQueueItem(baseQueueItem);

    expect(secondResult).toBe(QueueResult.Processed);
    expect(mockGetSuuntoActivityUploadStatus).toHaveBeenCalledWith(
      'user-1',
      'upload-1',
      'suunto-user-1',
    );
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledTimes(1);
  });

  it('persists a successful Wahoo upload token before post-provider writes', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledWith(
      queueItem.userID,
      Buffer.from('FITDATA'),
      expect.objectContaining({ expectedWorkoutTypeId: 9 }),
    );
    expect(mockEventGet.mock.invocationCallOrder[0])
      .toBeLessThan(mockUpdateQueueItemIfUserActive.mock.invocationCallOrder[0]);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_destination_provider_operation',
      updateData: expect.objectContaining({ destinationExpectedWorkoutTypeID: 9 }),
    }));
    expect(mockUpdateQueueItemIfUserActive.mock.invocationCallOrder[0])
      .toBeLessThan(mockUploadActivityFileToWahoo.mock.invocationCallOrder[0]);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_wahoo_upload_state_persist',
      updateData: expect.objectContaining({
        destinationUploadID: 'wahoo-upload-1',
      }),
    }));
    expect(mockUpdateQueueItemIfUserActive.mock.invocationCallOrder[0])
      .toBeLessThan(mockSetActivitySyncSuccessMetadata.mock.invocationCallOrder[0]);
    expect(mockRecordSuccessfulSuuntoActivityUploadForQueueItem).not.toHaveBeenCalled();
  });

  it('parks Wahoo delivery before upload when its connection requires reconnecting', async () => {
    mockGetServiceConnectionMeta
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ connectionState: 'reconnect_required' });

    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: {} as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };
    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
    expect(mockDeferQueueItemForReconnectRequiredIfCurrentUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'activity_sync_reconnect_required_transition',
      serviceName: ServiceNames.WahooAPI,
      additionalData: { deferredServiceName: ServiceNames.WahooAPI },
    }));
    expect(mockSetActivitySyncRetryingMetadataIfQueueItemDeferred).toHaveBeenCalledWith(expect.objectContaining({
      queueItemRef: queueItem.ref,
      deferredReason: 'service_reconnect_required',
    }));
    expect(mockSetActivitySyncRetryingMetadata).not.toHaveBeenCalled();
  });

  it('parks a Wahoo reconnect-required error before generic authentication handling', async () => {
    const reconnectError = Object.assign(new Error('Reconnect Wahoo to resume sync.'), {
      name: 'WahooReconnectRequiredError',
      code: 'unauthenticated',
    });
    mockIsWahooReconnectRequiredError.mockReturnValue(true);
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(reconnectError);

    const result = await processActivitySyncQueueItem({
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    });

    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForReconnectRequiredIfCurrentUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'activity_sync_reconnect_required_transition',
      serviceName: ServiceNames.WahooAPI,
    }));
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalled();
  });

  it('maps multiple persisted event activity types to Wahoo multisport', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ stats: { 'Activity Types': ['Running', 'Cycling'] } }),
    });

    await processActivitySyncQueueItem(queueItem);

    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledWith(
      queueItem.userID,
      Buffer.from('FITDATA'),
      expect.objectContaining({ expectedWorkoutTypeId: 62 }),
    );
  });

  it('keeps Wahoo inference for an explicitly unmapped persisted event type', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ stats: { 'Activity Types': ['Soccer'] } }),
    });

    await processActivitySyncQueueItem(queueItem);

    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledWith(
      queueItem.userID,
      Buffer.from('FITDATA'),
      expect.objectContaining({ expectedWorkoutTypeId: undefined }),
    );
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_destination_provider_operation',
      updateData: expect.objectContaining({ destinationExpectedWorkoutTypeID: null }),
    }));
  });

  it('moves an invalid durable Wahoo type to DLQ without calling the provider', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      destinationExpectedWorkoutTypeID: 999,
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockEventGet).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
    expect(mockGetWahooActivityUploadStatus).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({ message: 'Activity sync contains an invalid persisted Wahoo workout type.' }),
      undefined,
      'WAHOO_ACTIVITY_TYPE_CORRECTION_INVALID_TYPE',
    );
  });

  it('retries an event activity-type read failure before claiming or calling Wahoo', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockEventGet.mockRejectedValueOnce(Object.assign(new Error('Firestore unavailable'), {
      code: 'unavailable',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).not.toHaveBeenCalled();
  });

  it('persists a transient Wahoo type-correction resume ID and never reposts the FIT', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'resume',
      code: 'unavailable',
      message: 'Wahoo could not update the workout type.',
      providerOperationId: 'wahoo-correction-resume',
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_RETRY_EXHAUSTED',
    }));

    const firstResult = await processActivitySyncQueueItem(queueItem);

    expect(firstResult).toBe(QueueResult.RetryIncremented);
    expect(queueItem.destinationUploadID).toBe('wahoo-correction-resume');
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);

    const secondResult = await processActivitySyncQueueItem(queueItem);

    expect(secondResult).toBe(QueueResult.Processed);
    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      'wahoo-correction-resume',
      9,
    );
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
  });

  it('reuses the durable Wahoo type on resume without rereading a changed event', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      destinationUploadID: 'wahoo-accepted-upload',
      destinationExpectedWorkoutTypeID: 9,
    };
    mockEventGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ stats: { 'Activity Types': ['Cycling'] } }),
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockEventGet).not.toHaveBeenCalled();
    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      'wahoo-accepted-upload',
      9,
    );
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
  });

  it('retains the accepted Wahoo upload ID when type correction cannot be reconciled', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: 'Wahoo completed without a workout ID.',
      providerOperationId: 'wahoo-complete-without-workout-id',
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_MISSING_WORKOUT_ID',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(queueItem.destinationUploadID).toBe('wahoo-complete-without-workout-id');
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_wahoo_upload_state_persist',
      updateData: expect.objectContaining({
        destinationUploadID: 'wahoo-complete-without-workout-id',
      }),
    }));
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUploadID: 'wahoo-complete-without-workout-id',
      }),
      expect.objectContaining({ providerOperationId: 'wahoo-complete-without-workout-id' }),
      undefined,
      'WAHOO_ACTIVITY_TYPE_CORRECTION_MISSING_WORKOUT_ID',
    );
  });

  it('keeps a terminal correction upload ID durable when its first DLQ write fails', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: 'Wahoo rejected the workout type correction.',
      providerOperationId: 'wahoo-terminal-correction',
      dlqContext: 'WAHOO_ACTIVITY_TYPE_CORRECTION_REJECTED',
    }));
    mockMoveToDeadLetterQueue.mockResolvedValueOnce(QueueResult.Failed);

    const firstResult = await processActivitySyncQueueItem(queueItem);

    expect(firstResult).toBe(QueueResult.Failed);
    expect(queueItem.destinationUploadID).toBe('wahoo-terminal-correction');
    queueItem.providerOperationStartedAt = Date.now() - 13 * 60 * 1000;

    const secondResult = await processActivitySyncQueueItem(queueItem);

    expect(secondResult).toBe(QueueResult.Processed);
    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      'wahoo-terminal-correction',
      9,
    );
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
  });

  it('repeats only Wahoo status and its idempotent correction after final queue persistence fails', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));

    const firstResult = await processActivitySyncQueueItem(queueItem);

    expect(firstResult).toBe(QueueResult.Failed);
    expect(queueItem.destinationUploadID).toBe('wahoo-upload-1');
    queueItem.providerOperationStartedAt = Date.now() - 13 * 60 * 1000;

    const secondResult = await processActivitySyncQueueItem(queueItem);

    expect(secondResult).toBe(QueueResult.Processed);
    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      'wahoo-upload-1',
      9,
    );
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
  });


  it('clears an irrelevant signed continuation while persisting Wahoo upload state', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      destinationUploadContinuation: {
        type: 'suunto_blob_put_v1',
        uploadUrl: 'https://storage.suunto.com/stale-signed-url',
        uploadHeaders: { Authorization: 'stale-secret' },
      },
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_wahoo_upload_state_persist',
      updateData: expect.objectContaining({
        destinationUploadID: 'wahoo-upload-1',
        destinationUploadContinuation: null,
      }),
    }));
    expect(queueItem.destinationUploadContinuation).toBeNull();
  });

  it('treats a persisted cleared provider state as a fresh upload', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      destinationUploadID: null,
      destinationProviderUserID: null,
      destinationWorkoutKey: null,
      destinationInfoCode: null,
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledWith(
      'user-1',
      Buffer.from('FITDATA'),
      expect.objectContaining({ persistUploadStateBeforeBlob: expect.any(Function) }),
    );
    expect(mockGetSuuntoActivityUploadStatus).not.toHaveBeenCalled();
  });

  it('persists a pending Wahoo upload token and retries status checks without posting the FIT file again', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
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
      phase: 'before_activity_sync_wahoo_upload_state_persist',
      updateData: expect.objectContaining({ destinationUploadID: 'wahoo-upload-1' }),
    }));
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({ code: 'deadline-exceeded' }),
      1,
      undefined,
    );

    await processActivitySyncQueueItem(queueItem);

    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith('user-1', 'wahoo-upload-1', 9);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
  });

  it('persists COROS async identifiers and resumes status without uploading the FIT file again', async () => {
    const pollSchedulingStartedAtMs = 1_700_000_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(pollSchedulingStartedAtMs);
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };

    const firstResult = await processActivitySyncQueueItem(queueItem);

    dateNowSpy.mockRestore();

    expect(firstResult).toBe(QueueResult.ProviderStatusPending);
    expect(mockUploadActivityFileToCOROS).toHaveBeenCalledWith('user-1', Buffer.from('FITDATA'));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_coros_upload_state_persist',
      updateData: expect.objectContaining({
        destinationUploadID: '9223372036854775806',
        destinationProviderUserID: 'coros-user-1',
      }),
    }));
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        name: 'ProviderOperationError',
        disposition: 'retryable',
        retryMode: 'resume',
      }),
      1,
      undefined,
      'COROS_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    );
    const retryParams = mockIncreaseRetryCountIfCurrentParams.mock.calls.at(-1)?.[0] as MockActivitySyncRetryParams | undefined;
    expect(retryParams?.retryDispatchMarkerAtMs?.(1)).toBe(
      pollSchedulingStartedAtMs + (15 * 60 * 1000),
    );
    expect(queueItem.dispatchedToCloudTask).toBe(
      pollSchedulingStartedAtMs + (15 * 60 * 1000),
    );
    expect(mockSetActivitySyncRetryingMetadata).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[ActivitySync] Destination provider failure classified.',
      expect.anything(),
    );

    const secondResult = await processActivitySyncQueueItem(queueItem);

    expect(secondResult).toBe(QueueResult.Processed);
    expect(mockGetCOROSActivityUploadStatus).toHaveBeenCalledWith(
      'user-1',
      '9223372036854775806',
      'coros-user-1',
      { queueItemRef: queueItem.ref },
    );
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadActivityFileToCOROS).toHaveBeenCalledTimes(1);
  });

  it('keeps exhausted COROS pending polling visible as a terminal failure', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };
    mockIncreaseRetryCountForQueueItem.mockResolvedValueOnce(QueueResult.MovedToDLQ);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncRetryingMetadata).not.toHaveBeenCalled();
    expect(mockSetActivitySyncFailedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      destinationServiceName: ServiceNames.COROSAPI,
    }));
    expect(logger.error).toHaveBeenCalledWith(
      '[ActivitySync] Destination provider failure moved to DLQ.',
      expect.objectContaining({
        providerStatus: 1,
        outcome: 'dlq',
      }),
    );
  });

  it('moves a permanently rejected COROS status poll to DLQ', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
      destinationUploadID: '9223372036854775806',
      destinationProviderUserID: 'coros-user-1',
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };
    mockGetCOROSActivityUploadStatus.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.COROSAPI,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      code: 'provider-processing-failed',
      message: 'COROS could not process this activity file.',
      providerStatus: -1,
      providerUserId: 'coros-user-1',
      providerOperationId: '9223372036854775806',
      dlqContext: 'COROS_ACTIVITY_UPLOAD_FAILED',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        code: 'provider-processing-failed',
        providerStatus: -1,
      }),
      undefined,
      'COROS_ACTIVITY_UPLOAD_FAILED',
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[ActivitySync] Destination provider failure moved to DLQ.',
      expect.objectContaining({
        providerStatus: -1,
        outcome: 'dlq',
      }),
    );
  });

  it('retries COROS post-upload writes after the upload count marker is committed', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
      destinationUploadID: '9223372036854775806',
      destinationProviderUserID: 'coros-user-1',
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };
    mockSetActivitySyncSuccessMetadata.mockRejectedValueOnce(Object.assign(
      new Error('Firestore unavailable'),
      { code: 'unavailable' },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    const retryTransition = mockIncreaseRetryCountIfCurrentParams.mock.calls.at(-1)?.[0];
    expect(retryTransition?.isCurrent({
      ...queueItem,
      destinationUploadCountedID: '9223372036854775806',
      destinationUploadCountedAt: Date.now(),
    })).toBe(true);
    expect(mockGetCOROSActivityUploadStatus).toHaveBeenCalledOnce();
    expect(mockUploadActivityFileToCOROS).not.toHaveBeenCalled();
  });

  it('treats a missing pinned COROS token as disconnected before provider upload', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };
    mockGetActiveCOROSTokenSnapshot.mockRejectedValueOnce(Object.assign(
      new Error('Reconnect COROS before sending data.'),
      { code: 'unauthenticated' },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSkippedMetadata).toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'destination_not_connected',
    }));
    expect(mockUploadActivityFileToCOROS).not.toHaveBeenCalled();
    expect(mockRecordActivitySyncOutboundFingerprint).not.toHaveBeenCalled();
  });

  it('rejects incomplete COROS resume identifiers without calling the provider', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
      destinationUploadID: '42',
      destinationProviderUserID: null,
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockUploadActivityFileToCOROS).not.toHaveBeenCalled();
    expect(mockGetCOROSActivityUploadStatus).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({ dlqContext: 'DESTINATION_PROVIDER_INVALID_RESUME_STATE' }),
      undefined,
      'DESTINATION_PROVIDER_INVALID_RESUME_STATE',
    );
  });

  it('treats an identifier-less COROS duplicate as a completed delivery', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
      ref: {} as unknown as NonNullable<ActivitySyncQueueItemInterface['ref']>,
    };
    mockUploadActivityFileToCOROS.mockResolvedValueOnce({
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      message: 'Activity already exists in COROS.',
      providerUserId: 'coros-user-1',
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      destinationUploadID: undefined,
      infoCode: 'ALREADY_EXISTS',
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_success_finalize',
      updateData: expect.objectContaining({
        processed: true,
        destinationUploadID: null,
        destinationProviderUserID: 'coros-user-1',
        destinationInfoCode: 'ALREADY_EXISTS',
        resultStatus: 'success',
      }),
    }));
  });

  it('persists a pending Suunto upload and polls the same provider job on retry', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToSuunto.mockResolvedValueOnce({
      status: 'pending',
      message: 'Suunto is still processing the activity.',
      uploadId: 'suunto-pending-1',
      providerUserId: 'suunto-user-1',
    });

    const firstResult = await processActivitySyncQueueItem(queueItem);

    expect(firstResult).toBe(QueueResult.RetryIncremented);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItemDocument: queueItem.ref,
      queueItemId: queueItem.id,
      userID: queueItem.userID,
      phase: 'before_activity_sync_suunto_upload_state_persist',
      updateData: expect.objectContaining({
        destinationUploadID: 'suunto-pending-1',
        destinationProviderUserID: 'suunto-user-1',
      }),
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledTimes(2);
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        name: 'ProviderOperationError',
        disposition: 'retryable',
        retryMode: 'resume',
      }),
      1,
      undefined,
      'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    );

    await processActivitySyncQueueItem(queueItem);

    expect(mockGetSuuntoActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      'suunto-pending-1',
      'suunto-user-1',
    );
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledTimes(1);
  });

  it('moves an accepted Suunto upload to DLQ with resume identifiers when state persistence fails', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToSuunto.mockResolvedValueOnce({
      status: 'pending',
      message: 'Suunto is still processing the activity.',
      uploadId: 'suunto-pending-persist-failure',
      providerUserId: 'suunto-user-1',
    });
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUploadID: 'suunto-pending-persist-failure',
        destinationProviderUserID: 'suunto-user-1',
      }),
      expect.objectContaining({ code: 'internal' }),
      undefined,
      'DESTINATION_PROVIDER_RESUME_STATE_PERSIST_FAILED',
    );
  });

  it('moves an accepted Wahoo upload to DLQ with its resume identifier when state persistence fails', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToWahoo.mockResolvedValueOnce({
      status: 'pending',
      message: 'processing',
      uploadId: 'wahoo-pending-persist-failure',
    });
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUploadID: 'wahoo-pending-persist-failure',
      }),
      expect.objectContaining({ code: 'internal' }),
      undefined,
      'DESTINATION_PROVIDER_RESUME_STATE_PERSIST_FAILED',
    );
  });

  it('moves a malformed completed Wahoo response to DLQ instead of retrying the provider POST', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
    };
    const invalidResponseError = Object.assign(
      new Error('Wahoo completed the upload without a token.'),
      {
        code: 'failed-precondition',
        dlqContext: 'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
      },
    );
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(invalidResponseError);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      invalidResponseError,
      undefined,
      'WAHOO_ACTIVITY_UPLOAD_INVALID_RESPONSE',
    );
  });

  it('acknowledges an accepted Wahoo upload when both resume-state and DLQ persistence fail', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToWahoo.mockResolvedValueOnce({
      status: 'pending',
      message: 'processing',
      uploadId: 'wahoo-accepted-without-durable-state',
    });
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'));
    mockMoveToDeadLetterQueue.mockResolvedValueOnce(QueueResult.Failed);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Skipped);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledTimes(1);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledTimes(3);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_manual_reconciliation_persist',
      updateData: expect.objectContaining({
        processed: true,
        resultStatus: 'manual_reconciliation_required',
        expireAt: mockFieldValueDelete,
        destinationUploadID: 'wahoo-accepted-without-durable-state',
      }),
    }));
  });

  it('retries only the durable claim transition when accepted Wahoo work cannot be recorded', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToWahoo.mockResolvedValueOnce({
      status: 'pending',
      message: 'processing',
      uploadId: 'wahoo-accepted-without-any-state',
    });
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('Firestore unavailable'))
      .mockRejectedValueOnce(new Error('Firestore still unavailable'));
    mockMoveToDeadLetterQueue.mockResolvedValueOnce(QueueResult.Failed);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Failed);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledTimes(3);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
  });

  it('persists a resumable Suunto provider error before incrementing retry state', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'resume',
      code: 'unavailable',
      message: 'Suunto status is temporarily unavailable.',
      providerUserId: 'suunto-user-1',
      providerOperationId: 'suunto-resume-1',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      updateData: expect.objectContaining({
        destinationUploadID: 'suunto-resume-1',
        destinationProviderUserID: 'suunto-user-1',
      }),
    }));
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it('marks a normalized terminal Suunto auth failure as reconnect-required work instead of DLQ', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_init',
      disposition: 'auth_required',
      retryMode: 'none',
      code: 'unauthenticated',
      message: 'Authentication failed. Please re-connect your Suunto account.',
      providerUserId: 'suunto-user-1',
      dlqContext: 'AUTH_RECONNECT_REQUIRED',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'activity_sync_auth_skip_transition',
      updateData: expect.objectContaining({
        skippedReason: 'destination_auth_failed',
        destinationUploadContinuation: null,
        resultStatus: 'skipped',
      }),
    }));
    const guardedSkip = mockUpdateQueueItemIfUserActive.mock.calls.at(-1)?.[0];
    expect(guardedSkip.isCurrent({ ...queueItem })).toBe(true);
    expect(guardedSkip.isCurrent({
      ...queueItem,
      providerOperationStartedAt: Number(queueItem.providerOperationStartedAt) + 1,
    })).toBe(false);
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
  });

  it('fails closed when authentication is lost while polling an accepted upload', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'accepted-upload-1',
      destinationProviderUserID: 'suunto-user-1',
    };
    const authError = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'auth_required',
      retryMode: 'none',
      code: 'unauthenticated',
      message: 'Authentication failed. Please re-connect your Suunto account.',
      providerUserId: 'suunto-user-1',
      providerOperationId: 'accepted-upload-1',
      dlqContext: 'SUUNTO_AUTH_REQUIRED',
    });
    mockGetSuuntoActivityUploadStatus.mockRejectedValueOnce(authError);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUploadID: 'accepted-upload-1',
        destinationProviderUserID: 'suunto-user-1',
      }),
      authError,
      undefined,
      'SUUNTO_AUTH_REQUIRED',
    );
    expect(mockMoveToDeadLetterQueueIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: {
        additionalData: expect.objectContaining({
          destinationUploadID: 'accepted-upload-1',
          destinationProviderUserID: 'suunto-user-1',
          destinationUploadContinuation: null,
        }),
      },
    }));
  });

  it('fails closed on a legacy authentication error while polling an accepted upload', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'accepted-upload-legacy-auth',
      destinationProviderUserID: 'suunto-user-1',
    };
    const authError = Object.assign(new Error('No connected Suunto account found.'), {
      code: 'unauthenticated',
    });
    mockGetSuuntoActivityUploadStatus.mockRejectedValueOnce(authError);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({ destinationUploadID: 'accepted-upload-legacy-auth' }),
      authError,
      undefined,
      'DESTINATION_PROVIDER_AUTH_RECONCILIATION_REQUIRED',
    );
    expect(mockMoveToDeadLetterQueueIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: expect.objectContaining({
        additionalData: expect.objectContaining({
          destinationUploadID: 'accepted-upload-legacy-auth',
        }),
      }),
    }));
  });

  it('moves partial persisted Suunto resume state to DLQ without downloading or reposting the FIT file', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'suunto-upload-without-user',
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockGetSuuntoActivityUploadStatus).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        disposition: 'permanent',
        providerOperationId: 'suunto-upload-without-user',
      }),
      undefined,
      'DESTINATION_PROVIDER_INVALID_RESUME_STATE',
    );
  });

  it('moves a pending Suunto response without resumable identifiers directly to DLQ', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToSuunto.mockResolvedValueOnce({
      status: 'pending',
      message: 'Suunto is still processing the activity.',
      uploadId: 'suunto-pending-without-user',
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledOnce();
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_destination_provider_operation',
    }));
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        disposition: 'permanent',
        providerOperationId: 'suunto-pending-without-user',
      }),
      undefined,
      'DESTINATION_PROVIDER_INVALID_RESUME_STATE',
    );
  });

  it('uses persisted Suunto identifiers when a resumable status error omits them', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'suunto-existing-upload',
      destinationProviderUserID: 'suunto-existing-user',
    };
    mockGetSuuntoActivityUploadStatus.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'resume',
      code: 'unavailable',
      message: 'Suunto status is temporarily unavailable.',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledOnce();
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_destination_provider_operation',
    }));
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('preserves persisted Suunto identifiers when a successful status response omits them', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'suunto-existing-upload',
      destinationProviderUserID: 'suunto-existing-user',
      destinationWorkoutKey: 'suunto-existing-workout',
    };
    mockGetSuuntoActivityUploadStatus.mockResolvedValueOnce({
      status: 'success',
      message: 'Activity uploaded to Suunto',
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      destinationUploadID: 'suunto-existing-upload',
      workoutKey: 'suunto-existing-workout',
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'before_activity_sync_success_finalize',
        updateData: expect.objectContaining({
        destinationUploadID: 'suunto-existing-upload',
        destinationProviderUserID: 'suunto-existing-user',
        destinationWorkoutKey: 'suunto-existing-workout',
        }),
      }),
    );
  });

  it('does not carry stale job metadata into a fresh successful upload', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationWorkoutKey: 'stale-workout',
      destinationInfoCode: 'PROCESSING',
    };
    mockUploadActivityFileToSuunto.mockResolvedValueOnce({
      status: 'success',
      message: 'Activity uploaded to Suunto',
      uploadId: 'fresh-upload',
      providerUserId: 'suunto-user-1',
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      destinationUploadID: 'fresh-upload',
      workoutKey: undefined,
    }));
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'before_activity_sync_success_finalize',
        updateData: expect.objectContaining({
        destinationUploadID: 'fresh-upload',
        destinationProviderUserID: 'suunto-user-1',
        destinationWorkoutKey: null,
        destinationInfoCode: null,
        }),
      }),
    );
  });

  it('moves a resumable Suunto error without current or persisted identifiers directly to DLQ', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'resume',
      code: 'unavailable',
      message: 'Suunto status is temporarily unavailable.',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    }));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      baseQueueItem,
      expect.objectContaining({ disposition: 'permanent' }),
      undefined,
      'DESTINATION_PROVIDER_INVALID_RESUME_STATE',
    );
  });

  it('clears an errored Suunto upload before restarting it on the next retry', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'suunto-failed-1',
      destinationProviderUserID: 'suunto-user-1',
    };
    mockGetSuuntoActivityUploadStatus.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'unavailable',
      message: 'Suunto processing failed: Internal error',
      providerUserId: 'suunto-user-1',
      providerOperationId: 'suunto-failed-1',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_pending_upload_restart',
      updateData: expect.objectContaining({
        destinationUploadID: null,
        destinationProviderUserID: null,
        destinationWorkoutKey: null,
        destinationInfoCode: null,
        destinationUploadContinuation: null,
        dispatchedToCloudTask: null,
        providerOperationStartedAt: null,
      }),
    }));
    expect(queueItem.destinationUploadID).toBeNull();
    expect(queueItem.destinationProviderUserID).toBeNull();
    const restartUpdate = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_activity_sync_pending_upload_restart');
    const providerClaim = mockUpdateQueueItemIfUserActive.mock.calls
      .map(([params]) => params)
      .find(params => params.phase === 'before_activity_sync_destination_provider_operation');
    expect(restartUpdate?.isCurrent({
      ...queueItem,
      dateCreated: baseQueueItem.dateCreated,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt: providerClaim.updateData.providerOperationStartedAt,
      destinationUploadID: 'suunto-failed-1',
      destinationProviderUserID: 'suunto-user-1',
      destinationWorkoutKey: null,
      destinationInfoCode: null,
      destinationUploadContinuation: null,
    })).toBe(true);
    expect(restartUpdate?.isCurrent({
      ...queueItem,
      dateCreated: baseQueueItem.dateCreated,
      processed: false,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt: providerClaim.updateData.providerOperationStartedAt,
      destinationUploadID: 'replacement-upload',
      destinationProviderUserID: 'suunto-user-1',
      destinationWorkoutKey: null,
      destinationInfoCode: null,
      destinationUploadContinuation: null,
    })).toBe(false);
  });

  it('restarts a provider-confirmed failed Wahoo upload instead of requiring manual reconciliation', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      destinationUploadID: 'wahoo-definitively-failed-upload',
    };
    mockGetWahooActivityUploadStatus.mockRejectedValueOnce(Object.assign(
      new Error('Wahoo could not process this activity: FIT file is malformed'),
      {
        code: 'failed-precondition',
        details: {
          retryMode: 'restart',
          providerOperation: 'activity_upload_status',
        },
      },
    ));

    const retryResult = await processActivitySyncQueueItem(queueItem);

    expect(retryResult).toBe(QueueResult.RetryIncremented);
    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      'wahoo-definitively-failed-upload',
      9,
    );
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_pending_upload_restart',
      updateData: expect.objectContaining({
        destinationUploadID: null,
        destinationProviderUserID: null,
        destinationWorkoutKey: null,
        destinationInfoCode: null,
        destinationUploadContinuation: null,
        destinationExpectedWorkoutTypeID: mockFieldValueDelete,
      }),
    }));
    expect(queueItem.destinationUploadID).toBeNull();
    expect(queueItem.destinationExpectedWorkoutTypeID).toBeUndefined();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        operation: 'activity_upload_status',
        retryMode: 'restart',
        providerOperationId: 'wahoo-definitively-failed-upload',
      }),
      1,
      undefined,
      'WAHOO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    );

    const restartResult = await processActivitySyncQueueItem(queueItem);

    expect(restartResult).toBe(QueueResult.Processed);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledWith(
      queueItem.userID,
      Buffer.from('FITDATA'),
      expect.objectContaining({ expectedWorkoutTypeId: 9 }),
    );
  });

  it('does not restart a Wahoo status failure without the provider-confirmed restart signal', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      destinationUploadID: 'wahoo-status-failure-without-restart-confirmation',
    };
    mockGetWahooActivityUploadStatus.mockRejectedValueOnce(Object.assign(
      new Error('Wahoo could not process this activity.'),
      { code: 'failed-precondition' },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(queueItem.destinationUploadID).toBe('wahoo-status-failure-without-restart-confirmation');
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({ message: 'Wahoo could not process this activity.' }),
      undefined,
      'ACTIVITY_SYNC_PERMANENT_FAILURE',
    );
  });

  it('clears stale job metadata before restart even when upload identifiers are absent', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationWorkoutKey: 'stale-workout',
      destinationInfoCode: 'PROCESSING',
    };
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_init',
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'unavailable',
      message: 'Suunto is temporarily unavailable.',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_pending_upload_restart',
      updateData: expect.objectContaining({
        destinationUploadID: null,
        destinationProviderUserID: null,
        destinationWorkoutKey: null,
        destinationInfoCode: null,
        destinationUploadContinuation: null,
        dispatchedToCloudTask: null,
        providerOperationStartedAt: null,
      }),
    }));
    expect(queueItem.destinationWorkoutKey).toBeUndefined();
    expect(queueItem.destinationInfoCode).toBeUndefined();
  });

  it('moves an explicitly permanent Suunto provider failure directly to DLQ', async () => {
    const providerError = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'permanent',
      code: 'failed-precondition',
      message: 'Suunto processing failed: Unsupported FIT file format',
      providerStatus: -1,
      providerUserId: 'suunto-user-1',
      providerOperationId: 'suunto-rejected-1',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_REJECTED',
    });
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(providerError);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      baseQueueItem,
      expect.objectContaining({ disposition: 'permanent' }),
      undefined,
      'SUUNTO_ACTIVITY_UPLOAD_REJECTED',
    );
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      '[ActivitySync] Destination provider failure moved to DLQ.',
      expect.objectContaining({
        code: 'failed-precondition',
        providerStatus: -1,
        providerMessage: 'Suunto processing failed: Unsupported FIT file format',
      }),
    );
    const providerFailureLog = vi.mocked(logger.error).mock.calls.find(
      ([summary]) => summary === '[ActivitySync] Destination provider failure moved to DLQ.',
    );
    expect(providerFailureLog?.[1]).not.toHaveProperty('message');
  });

  it('moves an ambiguous Wahoo activity POST directly to DLQ without retrying it', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.WahooAPI,
      operation: 'activity_upload_init',
      disposition: 'permanent',
      retryMode: 'none',
      code: 'failed-precondition',
      message: 'Wahoo did not confirm whether the activity upload was accepted.',
      statusCode: 503,
      dlqContext: 'WAHOO_ACTIVITY_UPLOAD_AMBIGUOUS',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({ disposition: 'permanent' }),
      undefined,
      'WAHOO_ACTIVITY_UPLOAD_AMBIGUOUS',
    );
    expect(mockMoveToDeadLetterQueueIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: {
        additionalData: expect.objectContaining({
          destinationUploadContinuation: null,
        }),
      },
    }));
  });

  it('writes failed metadata when a retryable provider failure exhausts its queue budget', async () => {
    mockIncreaseRetryCountForQueueItem.mockResolvedValueOnce(QueueResult.MovedToDLQ);
    mockUploadActivityFileToSuunto.mockRejectedValueOnce(new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'retryable',
      retryMode: 'restart',
      code: 'unavailable',
      message: 'Suunto processing failed: Internal error',
      dlqContext: 'SUUNTO_ACTIVITY_UPLOAD_RETRY_EXHAUSTED',
    }));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalled();
    expect(mockSetActivitySyncFailedMetadata).toHaveBeenCalled();
  });

  it('does not persist a Wahoo upload token after account deletion begins', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToWahoo.mockResolvedValueOnce({
      status: 'pending',
      message: 'processing',
      uploadId: 'wahoo-upload-1',
    });
    mockUpdateQueueItemIfUserActive
      .mockResolvedValueOnce('updated')
      .mockResolvedValueOnce('skipped_deleted_user');

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(queueItem.destinationUploadID).toBeUndefined();
    expect(mockMarkQueueItemSkipped).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
  });

  it('moves an unresolved provider operation to DLQ without calling the provider again', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      ref: createMockActivitySyncQueueItemRef(),
    };

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      queueItem,
      expect.objectContaining({
        disposition: 'permanent',
        retryMode: 'none',
        dlqContext: 'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
      }),
      undefined,
      'DESTINATION_PROVIDER_OUTCOME_UNKNOWN',
    );
  });

  it('retries a recently claimed provider operation without changing queue state', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt: Date.now(),
      ref: createMockActivitySyncQueueItemRef(),
    };

    await expect(processActivitySyncQueueItem(queueItem)).rejects.toMatchObject({
      message: expect.stringContaining('still in flight'),
    });

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).not.toHaveBeenCalled();
  });

  it('does not let a duplicate worker poll a persisted upload while its lease is active', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      dispatchedToCloudTask: PROVIDER_OPERATION_IN_FLIGHT_QUEUE_DISPATCH_MARKER,
      providerOperationStartedAt: Date.now(),
      destinationUploadID: 'persisted-upload-1',
      destinationProviderUserID: 'suunto-user-1',
      ref: createMockActivitySyncQueueItemRef(),
    };

    await expect(processActivitySyncQueueItem(queueItem)).rejects.toMatchObject({
      message: expect.stringContaining('still in flight'),
    });

    expect(mockGetSuuntoActivityUploadStatus).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).not.toHaveBeenCalled();
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
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      destinationUploadContinuation: {
        uploadUrl: 'https://signed.example/upload',
        headers: { Authorization: 'signed-secret' },
      },
    };
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(true);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
      queueItem,
      undefined,
      'user_deleted_or_deleting',
      expect.objectContaining({
        skippedContext: 'USER_DELETION_GUARD',
        destinationUploadContinuation: null,
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
      providerUserId: 'suunto-user-1',
    });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      infoCode: 'ALREADY_EXISTS',
      destinationUploadID: 'upload-existing',
    }));
  });

  it('does not repost an identifier-less Wahoo duplicate when success metadata persistence fails', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      ref: createMockActivitySyncQueueItemRef(),
    };
    mockUploadActivityFileToWahoo.mockResolvedValueOnce({
      status: 'duplicate',
      code: 'ALREADY_EXISTS',
      message: 'Activity already exists in Wahoo.',
    });
    mockSetActivitySyncSuccessMetadata.mockRejectedValueOnce(Object.assign(
      new Error('Firestore unavailable'),
      { code: 'unavailable' },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledOnce();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_success_finalize',
      updateData: expect.objectContaining({
        processed: true,
        destinationInfoCode: 'ALREADY_EXISTS',
        resultStatus: 'success',
      }),
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

  it('defers a disabled route while atomic route restoration remains pending', async () => {
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);
    mockFinalizeDisabledSyncRouteIfCurrent.mockResolvedValueOnce({ result: 'deferred_for_restore' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('parks a route when reconnect-required wins after the earlier lifecycle read', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      sourceServiceName: ServiceNames.GarminAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);
    mockFinalizeDisabledSyncRouteIfCurrent.mockResolvedValueOnce({
      result: 'reconnect_required',
      serviceName: ServiceNames.WahooAPI,
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForReconnectRequiredIfCurrentUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItem,
      serviceName: ServiceNames.WahooAPI,
    }));
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
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

  it('fails closed instead of skipping an accepted upload when the destination now requires reconnect', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'accepted-upload-reconnect-required',
      destinationProviderUserID: 'suunto-user-1',
    };
    const authError = new ProviderOperationError({
      serviceName: ServiceNames.SuuntoApp,
      operation: 'activity_upload_status',
      disposition: 'auth_required',
      retryMode: 'none',
      code: 'unauthenticated',
      message: 'Authentication failed. Please re-connect your Suunto account.',
      providerUserId: 'suunto-user-1',
      providerOperationId: 'accepted-upload-reconnect-required',
      dlqContext: 'SUUNTO_AUTH_REQUIRED',
    });
    mockGetServiceConnectionMeta.mockImplementation(async (_userID: string, serviceName: ServiceNames) => (
      serviceName === ServiceNames.SuuntoApp
        ? { connectionState: 'reconnect_required' }
        : null
    ));
    mockGetSuuntoActivityUploadStatus.mockRejectedValueOnce(authError);

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockGetSuuntoActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      'accepted-upload-reconnect-required',
      'suunto-user-1',
    );
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'destination_not_connected',
    }));
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationUploadID: 'accepted-upload-reconnect-required',
        destinationProviderUserID: 'suunto-user-1',
      }),
      authError,
      undefined,
      'SUUNTO_AUTH_REQUIRED',
    );
    expect(mockMoveToDeadLetterQueueIfCurrentParams).toHaveBeenCalledWith(expect.objectContaining({
      manualReconciliation: {
        additionalData: expect.objectContaining({
          destinationUploadID: 'accepted-upload-reconnect-required',
          destinationProviderUserID: 'suunto-user-1',
          destinationUploadContinuation: null,
        }),
      },
    }));
  });

  it.each([
    ['allowlist misconfiguration', () => mockGetActivitySyncRouteAllowlistConfigError.mockReturnValue('allowlist misconfigured')],
    ['missing allowlist membership', () => mockIsActivitySyncRouteUserAllowlisted.mockReturnValue(false)],
    ['missing Pro access', () => mockHasProAccess.mockResolvedValue(false)],
    ['a disabled route', () => mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false)],
    ['a pending disconnect', () => mockGetServiceConnectionMeta.mockResolvedValue({ connectionState: 'disconnect_pending' })],
  ])('resumes an accepted Suunto upload before %s can skip it', async (_scenario, configureEligibilitySkip) => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      destinationUploadID: 'accepted-upload-before-eligibility-check',
      destinationProviderUserID: 'suunto-user-1',
    };
    configureEligibilitySkip();
    mockGetSuuntoActivityUploadStatus.mockResolvedValueOnce({
      status: 'success',
      message: 'Activity uploaded to Suunto.',
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockGetSuuntoActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      queueItem.destinationUploadID,
      queueItem.destinationProviderUserID,
    );
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      destinationUploadID: queueItem.destinationUploadID,
    }));
  });

  it('resumes an accepted Wahoo upload before a disabled route can skip it', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      ref: createMockActivitySyncQueueItemRef(),
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
      destinationUploadID: 'accepted-wahoo-upload-before-eligibility-check',
    };
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);
    mockGetWahooActivityUploadStatus.mockResolvedValueOnce({
      status: 'success',
      message: 'Activity uploaded to Wahoo.',
    });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockGetWahooActivityUploadStatus).toHaveBeenCalledWith(
      queueItem.userID,
      queueItem.destinationUploadID,
      9,
    );
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalled();
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalledWith(expect.objectContaining({
      destinationUploadID: queueItem.destinationUploadID,
    }));
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
    expect(mockSetActivitySyncRetryingMetadataIfQueueItemDeferred).toHaveBeenCalledWith(expect.objectContaining({
      queueItemRef: baseQueueItem.ref,
      deferredReason: 'service_disconnect_pending',
    }));
    expect(mockSetActivitySyncRetryingMetadata).not.toHaveBeenCalled();
    expect(mockDeferQueueItemForPendingDisconnect).toHaveBeenCalledWith(
      baseQueueItem,
      undefined,
      expect.objectContaining({
        deferredServiceName: `${ServiceNames.SuuntoApp}`,
      }),
      {
        userID: baseQueueItem.userID,
        serviceName: ServiceNames.SuuntoApp,
      },
    );
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('defers COROS when disconnect starts between connection metadata and active-account lookup', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_COROSAPI,
      destinationServiceName: ServiceNames.COROSAPI,
    };
    mockGetActiveCOROSTokenSnapshot.mockRejectedValueOnce(Object.assign(
      new Error('COROS disconnect is pending.'),
      {
        name: 'TokenUseSkippedForPendingDisconnectError',
        code: 'failed-precondition',
      },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockRecordActivitySyncOutboundFingerprint).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToCOROS).not.toHaveBeenCalled();
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'destination_not_connected',
    }));
  });

  it('defers when Wahoo detects a pending disconnect inside the provider adapter', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(Object.assign(
      new Error('Wahoo disconnect is pending.'),
      {
        name: 'TokenUseSkippedForPendingDisconnectError',
        serviceName: ServiceNames.WahooAPI,
      },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockDeferQueueItemForPendingDisconnectIfCurrentUserActive).toHaveBeenCalledWith(
      expect.objectContaining({
        queueItem,
        additionalData: expect.objectContaining({
          deferredServiceName: `${ServiceNames.WahooAPI}`,
        }),
        phase: 'activity_sync_pending_disconnect_transition',
      }),
    );
    const guardedDeferral = mockDeferQueueItemForPendingDisconnectIfCurrentUserActive.mock.calls[0][0];
    expect(guardedDeferral.isCurrent({ ...queueItem })).toBe(true);
    expect(guardedDeferral.isCurrent({ ...queueItem, processed: true })).toBe(false);
    expect(mockSetActivitySyncRetryingMetadataIfQueueItemDeferred).toHaveBeenCalledWith(expect.objectContaining({
      queueItemRef: queueItem.ref,
      deferredReason: 'service_disconnect_pending',
    }));
    expect(mockSetActivitySyncRetryingMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
  });

  it('does not overwrite successful metadata when a stale pending-disconnect worker cannot park its row', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(Object.assign(
      new Error('Wahoo disconnect is pending.'),
      {
        name: 'TokenUseSkippedForPendingDisconnectError',
        serviceName: ServiceNames.WahooAPI,
      },
    ));
    mockDeferQueueItemForPendingDisconnectIfCurrentUserActive.mockResolvedValueOnce(QueueResult.Processed);

    await expect(processActivitySyncQueueItem(queueItem)).resolves.toBe(QueueResult.Processed);

    expect(mockSetActivitySyncRetryingMetadata).not.toHaveBeenCalled();
    expect(mockSetActivitySyncRetryingMetadataIfQueueItemDeferred).not.toHaveBeenCalled();
  });

  it('persists an accepted Wahoo upload before deferring post-acceptance disconnect work', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(Object.assign(
      new Error('Wahoo disconnect is pending.'),
      {
        name: 'TokenUseSkippedForPendingDisconnectError',
        serviceName: ServiceNames.WahooAPI,
        providerOperationId: 'wahoo-accepted-upload',
      },
    ));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Deferred);
    expect(mockUpdateQueueItemIfUserActive).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'before_activity_sync_wahoo_upload_state_persist',
      updateData: expect.objectContaining({
        destinationUploadID: 'wahoo-accepted-upload',
      }),
    }));
    expect(mockDeferQueueItemForPendingDisconnectIfCurrentUserActive).toHaveBeenCalledWith(
      expect.objectContaining({
        queueItem: expect.objectContaining({
          destinationUploadID: 'wahoo-accepted-upload',
        }),
      }),
    );
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledTimes(1);
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
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
      {
        userID: queueItem.userID,
        serviceName: route.sourceServiceName,
      },
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
      {
        userID: baseQueueItem.userID,
        serviceName: route.sourceServiceName,
      },
    );
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
  });

  it('parks route-disabled Wahoo work when reconnect-required caused the disable', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);
    mockGetServiceConnectionMeta.mockResolvedValue({ connectionState: 'reconnect_required' });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(mockGetServiceConnectionMeta).toHaveBeenCalledWith(queueItem.userID, ServiceNames.WahooAPI);
    expect(mockDeferQueueItemForReconnectRequiredIfCurrentUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItem,
      serviceName: ServiceNames.WahooAPI,
      phase: 'activity_sync_reconnect_required_transition',
    }));
    expect(result).toBe(QueueResult.Deferred);
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
    expect(mockUploadActivityFileToWahoo).not.toHaveBeenCalled();
  });

  it('parks a route-disabled delivery when its Wahoo source requires reconnecting', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.WahooAPI_to_SuuntoApp,
      sourceServiceName: ServiceNames.WahooAPI,
      destinationServiceName: ServiceNames.SuuntoApp,
    };
    mockIsActivitySyncRouteEnabledForUser.mockResolvedValue(false);
    mockGetServiceConnectionMeta.mockResolvedValue({ connectionState: 'reconnect_required' });

    const result = await processActivitySyncQueueItem(queueItem);

    expect(mockGetServiceConnectionMeta).toHaveBeenCalledWith(queueItem.userID, ServiceNames.WahooAPI);
    expect(mockDeferQueueItemForReconnectRequiredIfCurrentUserActive).toHaveBeenCalledWith(expect.objectContaining({
      queueItem,
      serviceName: ServiceNames.WahooAPI,
      phase: 'activity_sync_reconnect_required_transition',
    }));
    expect(result).toBe(QueueResult.Deferred);
    expect(mockSetActivitySyncSkippedMetadata).not.toHaveBeenCalledWith(expect.objectContaining({
      skippedReason: 'route_disabled',
    }));
    expect(mockUpdateToProcessed).not.toHaveBeenCalled();
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
    expect(mockUploadActivityFileToSuunto).toHaveBeenCalledWith(
      'user-1',
      Buffer.from('FITDATA'),
      expect.objectContaining({ persistUploadStateBeforeBlob: expect.any(Function) }),
    );
    expect(mockSetActivitySyncSuccessMetadata).toHaveBeenCalled();
  });

  it('increments retry for transient upload failures', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue({ statusCode: 503, message: 'temporarily unavailable' });

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalled();
  });

  it('increments retry for Suunto upload status internal errors instead of moving directly to DLQ', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue(Object.assign(
      new Error('Suunto processing failed: Internal error'),
      { code: 'internal' },
    ));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockSetActivitySyncRetryingMetadata).toHaveBeenCalledWith(expect.objectContaining({
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_SuuntoApp,
      destinationServiceName: ServiceNames.SuuntoApp,
    }));
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      baseQueueItem,
      expect.objectContaining({
        message: 'Suunto processing failed: Internal error',
      }),
      1,
      undefined,
    );
    expect(mockSetActivitySyncFailedMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
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

  it('marks processed as skipped when Wahoo detects deletion during destination upload', async () => {
    const queueItem: ActivitySyncQueueItemInterface = {
      ...baseQueueItem,
      routeId: ACTIVITY_SYNC_ROUTE_IDS.GarminAPI_to_WahooAPI,
      destinationServiceName: ServiceNames.WahooAPI,
    };
    mockUploadActivityFileToWahoo.mockRejectedValueOnce(Object.assign(new Error('deleted during Wahoo upload'), {
      name: 'WahooActivityUploadSkippedForDeletedUserError',
      code: 'user_deleted_or_deleting',
    }));

    const result = await processActivitySyncQueueItem(queueItem);

    expect(result).toBe(QueueResult.Processed);
    expect(mockUploadActivityFileToWahoo).toHaveBeenCalledWith('user-1', Buffer.from('FITDATA'), expect.objectContaining({
      filename: 'original.fit',
    }));
    expect(mockSetActivitySyncFailedMetadata).not.toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
    expect(mockMarkQueueItemSkipped).toHaveBeenCalledWith(
      queueItem,
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

  it('increments retry for Firestore resource exhaustion reported as numeric gRPC code', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue({ code: 8, message: 'quota temporarily exhausted' });

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

  it('increments retry for an HTTP 408 before upload starts', async () => {
    const timeoutError = Object.assign(new Error('token request timed out'), { statusCode: 408 });
    mockHasProAccess.mockRejectedValue(timeoutError);

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.RetryIncremented);
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).toHaveBeenCalledWith(
      baseQueueItem,
      timeoutError,
      1,
      undefined,
    );
    expect(mockMoveToDeadLetterQueue).not.toHaveBeenCalled();
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

  it('does not apply the legacy Suunto message retry outside the provider upload phase', async () => {
    mockHasProAccess.mockRejectedValue(new Error('Suunto processing failed: Internal error'));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockUploadActivityFileToSuunto).not.toHaveBeenCalled();
    expect(mockIncreaseRetryCountForQueueItem).not.toHaveBeenCalled();
  });

  it('moves to DLQ for permanent failures', async () => {
    mockUploadActivityFileToSuunto.mockRejectedValue(new Error('permanent failure'));

    const result = await processActivitySyncQueueItem(baseQueueItem);

    expect(result).toBe(QueueResult.MovedToDLQ);
    expect(mockSetActivitySyncFailedMetadata).toHaveBeenCalled();
    expect(mockMoveToDeadLetterQueue).toHaveBeenCalled();
  });
});
