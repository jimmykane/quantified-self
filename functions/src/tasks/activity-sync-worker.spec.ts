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
  mockProcessActivitySyncQueueItem,
} = vi.hoisted(() => ({
  mockQueueGet: vi.fn(),
  mockFailedJobsGet: vi.fn(),
  mockProcessActivitySyncQueueItem: vi.fn(),
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

vi.mock('../queue-utils', () => ({
  QueueResult: {
    Processed: 'PROCESSED',
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

import { processActivitySyncTask } from './activity-sync-worker';

const invokeWorker = (request: TaskRequestMock): Promise<void> =>
  (processActivitySyncTask as unknown as TaskCallableMock)(request);

describe('processActivitySyncTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
