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
  mockProcessSleepSyncQueueItem,
} = vi.hoisted(() => ({
  mockQueueGet: vi.fn(),
  mockFailedJobsGet: vi.fn(),
  mockIsQueueItemDeletedForUserCleanup: vi.fn(),
  mockProcessSleepSyncQueueItem: vi.fn(),
}));

vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: (_opts: unknown, handler: TaskHandlerMock) => handler,
}));

vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string) => ({
        id,
        get: collectionName === 'sleepSyncQueue' ? mockQueueGet : mockFailedJobsGet,
        ref: { id, path: `${collectionName}/${id}` },
      })),
    })),
  }),
}));

vi.mock('../sleep/queue', () => ({
  processSleepSyncQueueItem: mockProcessSleepSyncQueueItem,
}));

vi.mock('../queue/cleanup-tombstone', () => ({
  isQueueItemDeletedForUserCleanup: mockIsQueueItemDeletedForUserCleanup,
}));

vi.mock('../queue-utils', () => ({
  QueueResult: {
    Processed: 'PROCESSED',
    Skipped: 'SKIPPED',
    RetryIncremented: 'RETRY_INCREMENTED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    Failed: 'FAILED',
  },
}));

vi.mock('firebase-functions/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { processSleepSyncTask } from './sleep-sync-worker';

const invokeWorker = (request: TaskRequestMock): Promise<void> =>
  (processSleepSyncTask as unknown as TaskCallableMock)(request);

describe('processSleepSyncTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsQueueItemDeletedForUserCleanup.mockResolvedValue(false);
  });

  it('processes a valid queue item', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'sleep-item-1',
      ref: { path: 'sleepSyncQueue/sleep-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
      }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('PROCESSED');

    await expect(invokeWorker({ data: { queueItemId: 'sleep-item-1' } })).resolves.toBeUndefined();

    expect(mockProcessSleepSyncQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sleep-item-1',
      processed: false,
      userID: 'user-1',
    }));
  });

  it('stops retries when queue item is missing but exists in failed_jobs', async () => {
    mockQueueGet.mockResolvedValueOnce({ exists: false });
    mockFailedJobsGet.mockResolvedValueOnce({ exists: true });

    await expect(invokeWorker({ data: { queueItemId: 'sleep-item-1' } })).resolves.toBeUndefined();
    expect(mockProcessSleepSyncQueueItem).not.toHaveBeenCalled();
  });

  it('stops retries when queue item was deleted during queue cleanup', async () => {
    mockQueueGet.mockResolvedValueOnce({ exists: false });
    mockFailedJobsGet.mockResolvedValueOnce({ exists: false });
    mockIsQueueItemDeletedForUserCleanup.mockResolvedValueOnce(true);

    await expect(invokeWorker({ data: { queueItemId: 'sleep-item-1' } })).resolves.toBeUndefined();

    expect(mockIsQueueItemDeletedForUserCleanup).toHaveBeenCalledWith('sleepSyncQueue', 'sleep-item-1');
    expect(mockProcessSleepSyncQueueItem).not.toHaveBeenCalled();
  });

  it('throws when queue item is missing without failed job or cleanup tombstone', async () => {
    mockQueueGet.mockResolvedValueOnce({ exists: false });
    mockFailedJobsGet.mockResolvedValueOnce({ exists: false });

    await expect(invokeWorker({ data: { queueItemId: 'sleep-item-1' } }))
      .rejects
      .toThrow('[SleepSyncTaskWorker] Queue item sleep-item-1 not found in sleepSyncQueue');
  });
});
