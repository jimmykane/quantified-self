import { beforeEach, describe, expect, it, vi } from 'vitest';

interface TaskRequestMock {
  data: {
    queueItemId: string;
  };
}

type TaskHandlerMock = (request: TaskRequestMock) => unknown;
type TaskCallableMock = (request: TaskRequestMock) => Promise<void>;

const {
  mockQueueGet,
  mockFailedJobsGet,
  mockIsQueueItemDeletedForUserCleanup,
  mockProcessActivitySyncQueueItem,
  mockEnqueueActivitySyncTask,
  mockShouldSkipQueueWorkForDeletedUser,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockQueueGet: vi.fn(),
  mockFailedJobsGet: vi.fn(),
  mockIsQueueItemDeletedForUserCleanup: vi.fn(),
  mockProcessActivitySyncQueueItem: vi.fn(),
  mockEnqueueActivitySyncTask: vi.fn(),
  mockShouldSkipQueueWorkForDeletedUser: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: (_opts: unknown, handler: TaskHandlerMock) => handler,
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string) => ({
        id,
        get: collectionName === 'activitySyncQueue' ? mockQueueGet : mockFailedJobsGet,
        ref: { id, path: `${collectionName}/${id}` },
      })),
    })),
  }),
}));

vi.mock('../activity-sync/process-queue-item', () => ({
  processActivitySyncQueueItem: mockProcessActivitySyncQueueItem,
}));

vi.mock('../shared/cloud-tasks', () => ({
  enqueueActivitySyncTask: mockEnqueueActivitySyncTask,
}));

vi.mock('../queue/cleanup-tombstone', () => ({
  isQueueItemDeletedForUserCleanup: mockIsQueueItemDeletedForUserCleanup,
}));

vi.mock('../queue/user-deletion-skip', () => ({
  shouldSkipQueueWorkForDeletedUser: mockShouldSkipQueueWorkForDeletedUser,
}));

vi.mock('../queue-utils', () => ({
  QueueResult: {
    Processed: 'PROCESSED',
    Skipped: 'SKIPPED',
    Deferred: 'DEFERRED',
    ProviderStatusPending: 'PROVIDER_STATUS_PENDING',
    RetryIncremented: 'RETRY_INCREMENTED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    Failed: 'FAILED',
  },
}));

vi.mock('firebase-functions/logger', () => ({
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError,
}));

import { processActivitySyncTask } from './activity-sync-worker';

const invokeWorker = (request: TaskRequestMock): Promise<void> =>
  (processActivitySyncTask as unknown as TaskCallableMock)(request);

describe('processActivitySyncTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsQueueItemDeletedForUserCleanup.mockResolvedValue(false);
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValue(false);
  });

  it('processes a valid queue item', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
      }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('PROCESSED');

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();

    expect(mockProcessActivitySyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'queue-item-1',
      processed: false,
      userID: 'user-1',
    }));
  });

  it('returns without processing when queue item is already processed', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({ processed: true }),
    });

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();
    expect(mockProcessActivitySyncQueueItem).not.toHaveBeenCalled();
  });

  it('fails clearly when an existing queue document has no payload', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => undefined,
    });

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } }))
      .rejects
      .toThrow('[ActivitySyncTaskWorker] Queue item queue-item-1 has no data.');
    expect(mockProcessActivitySyncQueueItem).not.toHaveBeenCalled();
  });

  it('stops retries when queue item is missing but exists in failed_jobs', async () => {
    mockQueueGet.mockResolvedValueOnce({ exists: false });
    mockFailedJobsGet.mockResolvedValueOnce({ exists: true });

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();
    expect(mockProcessActivitySyncQueueItem).not.toHaveBeenCalled();
  });

  it('throws when queue item is missing and not in failed_jobs', async () => {
    mockQueueGet.mockResolvedValueOnce({ exists: false });
    mockFailedJobsGet.mockResolvedValueOnce({ exists: false });

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } }))
      .rejects
      .toThrow('[ActivitySyncTaskWorker] Queue item queue-item-1 not found in activitySyncQueue');
  });

  it('stops retries when queue item was deleted during queue cleanup', async () => {
    mockQueueGet.mockResolvedValueOnce({ exists: false });
    mockFailedJobsGet.mockResolvedValueOnce({ exists: false });
    mockIsQueueItemDeletedForUserCleanup.mockResolvedValueOnce(true);

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();

    expect(mockIsQueueItemDeletedForUserCleanup).toHaveBeenCalledWith('activitySyncQueue', 'queue-item-1');
    expect(mockProcessActivitySyncQueueItem).not.toHaveBeenCalled();
  });

  it('rethrows when processing signals retry', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({ processed: false }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('RETRY_INCREMENTED');

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } }))
      .rejects
      .toThrow('Item queue-item-1 failed and was scheduled for retry.');
  });

  it('surfaces a redacted retry reason in Cloud Task errors', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({
        processed: false,
        errors: [{
          error: 'Wahoo is still processing the activity. Bearer sensitive-token token=another-secret https://api.example.test/status?x-sig=secret',
          atRetryCount: 1,
          date: 1,
        }],
      }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('RETRY_INCREMENTED');

    const error = await invokeWorker({ data: { queueItemId: 'queue-item-1' } }).catch((caughtError) => caughtError as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      'Item queue-item-1 failed and was scheduled for retry: Wahoo is still processing the activity. Bearer [redacted] token=[redacted] [url]',
    );
  });

  it('stops Cloud Task retries when processing defers the queue item', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({ processed: false }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('DEFERRED');

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();
  });

  it('schedules a pending COROS status poll and completes at info level', async () => {
    const nowMs = 1_700_000_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({
        processed: false,
        retryCount: 1,
        userID: 'user-1',
        destinationServiceName: 'corosAPI',
      }),
    });
    mockProcessActivitySyncQueueItem.mockImplementationOnce(async (queueItem: {
      retryCount?: number;
      dispatchedToCloudTask?: number | null;
    }) => {
      queueItem.retryCount = 2;
      // Use a due time below the 30-minute retry fallback so this verifies that
      // the worker honors the durable transaction marker.
      queueItem.dispatchedToCloudTask = nowMs + (25 * 60 * 1000);
      return 'PROVIDER_STATUS_PENDING';
    });
    mockEnqueueActivitySyncTask.mockResolvedValueOnce(true);

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();
    dateNowSpy.mockRestore();

    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith(
      'queue-item-1',
      nowMs + (25 * 60 * 1000),
      1500,
    );
    expect(mockShouldSkipQueueWorkForDeletedUser).toHaveBeenCalledWith(
      'user-1',
      'corosAPI',
      'queue-item-1',
      'before_activity_sync_pending_status_poll_enqueue',
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[ActivitySyncTaskWorker] COROS activity upload is still processing; status poll is scheduled.',
      expect.objectContaining({
        queueItemId: 'queue-item-1',
        providerStatus: 1,
        pollDelaySeconds: 1500,
        retryCount: 2,
        taskEnqueued: true,
      }),
    );
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('re-enqueues an already planned COROS status poll without polling early', async () => {
    const nowMs = 1_700_000_000_000;
    const scheduledAtMs = nowMs + (25 * 60 * 1000);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({
        processed: false,
        retryCount: 2,
        userID: 'user-1',
        destinationServiceName: 'corosAPI',
        destinationUploadID: 'coros-upload-1',
        destinationProviderUserID: 'coros-user-1',
        dispatchedToCloudTask: scheduledAtMs,
      }),
    });
    mockEnqueueActivitySyncTask.mockResolvedValueOnce(false);

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();
    dateNowSpy.mockRestore();

    expect(mockProcessActivitySyncQueueItem).not.toHaveBeenCalled();
    expect(mockShouldSkipQueueWorkForDeletedUser).toHaveBeenCalledWith(
      'user-1',
      'corosAPI',
      'queue-item-1',
      'before_activity_sync_pending_status_poll_enqueue',
    );
    expect(mockEnqueueActivitySyncTask).toHaveBeenCalledWith(
      'queue-item-1',
      scheduledAtMs,
      1500,
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[ActivitySyncTaskWorker] COROS activity upload is still processing; status poll is scheduled.',
      expect.objectContaining({
        taskEnqueued: false,
        reschedulingExistingPoll: true,
      }),
    );
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('processes a COROS status poll once it is within the scheduling grace window', async () => {
    const nowMs = 1_700_000_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({
        processed: false,
        retryCount: 2,
        userID: 'user-1',
        destinationServiceName: 'corosAPI',
        destinationUploadID: 'coros-upload-1',
        destinationProviderUserID: 'coros-user-1',
        dispatchedToCloudTask: nowMs + (5 * 1000),
      }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('PROCESSED');

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();
    dateNowSpy.mockRestore();

    expect(mockProcessActivitySyncQueueItem).toHaveBeenCalledOnce();
    expect(mockEnqueueActivitySyncTask).not.toHaveBeenCalled();
  });

  it('does not enqueue a pending COROS status poll after account deletion starts', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
        destinationServiceName: 'corosAPI',
      }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('PROVIDER_STATUS_PENDING');
    mockShouldSkipQueueWorkForDeletedUser.mockResolvedValueOnce(true);

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();

    expect(mockShouldSkipQueueWorkForDeletedUser).toHaveBeenCalledWith(
      'user-1',
      'corosAPI',
      'queue-item-1',
      'before_activity_sync_pending_status_poll_enqueue',
    );
    expect(mockEnqueueActivitySyncTask).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[ActivitySyncTaskWorker] Skipping pending COROS status poll for item queue-item-1 because the account is deleted or deleting.',
    );
  });

  it('rethrows a pending-poll scheduling failure so Cloud Tasks retries it', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
        destinationServiceName: 'corosAPI',
      }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('PROVIDER_STATUS_PENDING');
    const schedulingError = new Error('Cloud Tasks unavailable');
    mockEnqueueActivitySyncTask.mockRejectedValueOnce(schedulingError);

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } }))
      .rejects
      .toThrow('Cloud Tasks unavailable');
    expect(mockLoggerError).toHaveBeenCalledWith(
      '[ActivitySyncTaskWorker] Error processing item queue-item-1:',
      schedulingError,
    );
  });

  it('stops Cloud Task retries when accepted provider work requires manual reconciliation', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'queue-item-1',
      ref: { path: 'activitySyncQueue/queue-item-1' },
      data: () => ({ processed: false }),
    });
    mockProcessActivitySyncQueueItem.mockResolvedValueOnce('SKIPPED');

    await expect(invokeWorker({ data: { queueItemId: 'queue-item-1' } })).resolves.toBeUndefined();
  });
});
