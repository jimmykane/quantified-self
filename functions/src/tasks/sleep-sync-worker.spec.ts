import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';

interface TaskRequestMock {
  data: {
    queueItemId: string;
    queueRevision?: string;
    queueDateCreated?: number;
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
    Deferred: 'DEFERRED',
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

  it('processes only the queue revision bound into the task payload', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'sleep-item-1',
      ref: { path: 'sleepSyncQueue/sleep-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
        queueRevision: 'revision-2',
        dateCreated: 200,
      }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('PROCESSED');

    await expect(invokeWorker({
      data: {
        queueItemId: 'sleep-item-1',
        queueRevision: 'revision-2',
        queueDateCreated: 200,
      },
    })).resolves.toBeUndefined();

    expect(mockProcessSleepSyncQueueItem).toHaveBeenCalledOnce();
  });

  it('does not let a stale task process a replacement revision', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'sleep-item-1',
      ref: { path: 'sleepSyncQueue/sleep-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
        queueRevision: 'revision-2',
        dateCreated: 200,
      }),
    });

    await expect(invokeWorker({
      data: {
        queueItemId: 'sleep-item-1',
        queueRevision: 'revision-1',
        queueDateCreated: 100,
      },
    })).resolves.toBeUndefined();

    expect(mockProcessSleepSyncQueueItem).not.toHaveBeenCalled();
  });

  it('uses the creation time only for an unrevisioned legacy queue item', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'sleep-item-1',
      ref: { path: 'sleepSyncQueue/sleep-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
        dateCreated: 100,
      }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('PROCESSED');

    await expect(invokeWorker({
      data: {
        queueItemId: 'sleep-item-1',
        queueDateCreated: 100,
      },
    })).resolves.toBeUndefined();
    expect(mockProcessSleepSyncQueueItem).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'sleep-item-1',
      ref: { path: 'sleepSyncQueue/sleep-item-1' },
      data: () => ({
        processed: false,
        userID: 'user-1',
        queueRevision: 'revision-2',
        dateCreated: 100,
      }),
    });

    await expect(invokeWorker({
      data: {
        queueItemId: 'sleep-item-1',
        queueDateCreated: 100,
      },
    })).resolves.toBeUndefined();
    expect(mockProcessSleepSyncQueueItem).not.toHaveBeenCalled();
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

  it('stops Cloud Task retries when processing defers the queue item', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'sleep-item-1',
      ref: { path: 'sleepSyncQueue/sleep-item-1' },
      data: () => ({ processed: false }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('DEFERRED');

    await expect(invokeWorker({ data: { queueItemId: 'sleep-item-1' } })).resolves.toBeUndefined();
  });

  it('records a safe Suunto Health workload summary without account or payload fields', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'private-queue-item',
      ref: { path: 'sleepSyncQueue/private-queue-item' },
      data: () => ({
        type: 'suunto_health_poll',
        provider: 'SuuntoApp',
        healthTrigger: 'webhook',
        userID: 'private-user',
        providerUserId: 'private-account',
        payload: { secret: 'private-payload' },
      }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('PROCESSED');

    await invokeWorker({ data: { queueItemId: 'private-queue-item' } });

    const summaryCall = vi.mocked(logger.info).mock.calls.find(
      ([message]) => message === '[SleepSyncTaskWorker] Invocation summary',
    );
    expect(summaryCall?.[1]).toEqual({
      provider: 'SuuntoApp',
      queueType: 'suunto_health_poll',
      healthTrigger: 'webhook',
      garminSummaryType: 'none',
      outcome: 'processed',
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(summaryCall)).not.toContain('private-');
  });

  it('records failed Garmin work with only allowlisted dimensions', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'garmin-item',
      ref: { path: 'sleepSyncQueue/garmin-item' },
      data: () => ({
        type: 'garmin_ping',
        provider: 'GarminAPI',
        garminSummaryType: 'hrv',
        callbackURL: 'https://private.example/callback',
      }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('RETRY_INCREMENTED');

    await expect(invokeWorker({ data: { queueItemId: 'garmin-item' } }))
      .rejects.toThrow('scheduled for retry');

    const summaryCall = vi.mocked(logger.info).mock.calls.find(
      ([message]) => message === '[SleepSyncTaskWorker] Invocation summary',
    );
    expect(summaryCall?.[1]).toEqual({
      provider: 'GarminAPI',
      queueType: 'garmin_ping',
      healthTrigger: 'none',
      garminSummaryType: 'hrv',
      outcome: 'retry_incremented',
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(summaryCall)).not.toContain('private.example');
  });

  it('classifies a legacy Garmin Ping without a summary family as Sleep', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'legacy-garmin-ping',
      ref: { path: 'sleepSyncQueue/legacy-garmin-ping' },
      data: () => ({ type: 'garmin_ping', provider: 'GarminAPI' }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('PROCESSED');

    await invokeWorker({ data: { queueItemId: 'legacy-garmin-ping' } });

    expect(vi.mocked(logger.info).mock.calls.find(
      ([message]) => message === '[SleepSyncTaskWorker] Invocation summary',
    )?.[1]).toEqual(expect.objectContaining({
      provider: 'GarminAPI',
      queueType: 'garmin_ping',
      garminSummaryType: 'sleeps',
    }));
  });

  it('does not log unrecognized queue values as telemetry dimensions', async () => {
    mockQueueGet.mockResolvedValueOnce({
      exists: true,
      id: 'unknown-item',
      ref: { path: 'sleepSyncQueue/unknown-item' },
      data: () => ({
        type: 'injected-queue-type',
        provider: 'injected-provider',
        garminSummaryType: 'injected-family',
        healthTrigger: 'injected-trigger',
      }),
    });
    mockProcessSleepSyncQueueItem.mockResolvedValueOnce('DEFERRED');

    await invokeWorker({ data: { queueItemId: 'unknown-item' } });

    const summaryCall = vi.mocked(logger.info).mock.calls.find(
      ([message]) => message === '[SleepSyncTaskWorker] Invocation summary',
    );
    expect(summaryCall?.[1]).toEqual({
      provider: 'unknown',
      queueType: 'unknown',
      healthTrigger: 'none',
      garminSummaryType: 'none',
      outcome: 'deferred',
      durationMs: expect.any(Number),
    });
  });
});
