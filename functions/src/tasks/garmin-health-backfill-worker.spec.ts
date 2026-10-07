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

const hoisted = vi.hoisted(() => ({
  queueGet: vi.fn(),
  failedJobsGet: vi.fn(),
  cleanupDeleted: vi.fn(),
  processItem: vi.fn(),
}));

vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: (_options: unknown, handler: TaskHandlerMock) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('firebase-admin', () => ({
  firestore: () => ({
    collection: vi.fn((collectionName: string) => ({
      doc: vi.fn((id: string) => ({
        id,
        get: collectionName === 'sleepSyncQueue' ? hoisted.queueGet : hoisted.failedJobsGet,
        ref: { id, path: `${collectionName}/${id}` },
      })),
    })),
  }),
}));
vi.mock('../garmin/health-backfill', () => ({
  processGarminHealthBackfillQueueItem: hoisted.processItem,
}));
vi.mock('../queue/cleanup-tombstone', () => ({
  isQueueItemDeletedForUserCleanup: hoisted.cleanupDeleted,
}));
vi.mock('../queue-utils', () => ({
  QueueResult: {
    Processed: 'PROCESSED',
    RetryIncremented: 'RETRY_INCREMENTED',
    MovedToDLQ: 'MOVED_TO_DLQ',
    Failed: 'FAILED',
  },
}));
vi.mock('../secrets', () => ({
  FUNCTION_SECRET_BINDINGS: { processGarminHealthBackfillTask: [] },
}));
vi.mock('../shared/queue-config', () => ({
  CLOUD_TASK_RETRY_CONFIG: {},
  GARMIN_HEALTH_BACKFILL_TASK_TIMEOUT_SECONDS: 1_800,
}));
vi.mock('../../../shared/functions-manifest', () => ({
  FUNCTIONS_MANIFEST: { processGarminHealthBackfillTask: { region: 'europe-west2' } },
}));

import { processGarminHealthBackfillTask } from './garmin-health-backfill-worker';

const invokeWorker = (request: TaskRequestMock): Promise<void> =>
  (processGarminHealthBackfillTask as unknown as TaskCallableMock)(request);

function queueSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    id: 'garmin-health-1',
    ref: { path: 'sleepSyncQueue/garmin-health-1' },
    data: () => ({
      type: 'garmin_health_backfill',
      provider: 'GarminAPI',
      processed: false,
      userID: 'user-1',
      queueRevision: 'revision-1',
      dateCreated: 100,
      ...overrides,
    }),
  };
}

describe('processGarminHealthBackfillTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.cleanupDeleted.mockResolvedValue(false);
  });

  it('processes the bound Garmin Health backfill revision', async () => {
    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot());
    hoisted.processItem.mockResolvedValueOnce('PROCESSED');

    await expect(invokeWorker({
      data: {
        queueItemId: 'garmin-health-1',
        queueRevision: 'revision-1',
        queueDateCreated: 100,
      },
    })).resolves.toBeUndefined();

    expect(hoisted.processItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'garmin-health-1',
      type: 'garmin_health_backfill',
    }));
  });

  it('does not process a replacement revision or an ordinary Sleep job', async () => {
    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot({ queueRevision: 'revision-2' }));
    await expect(invokeWorker({
      data: { queueItemId: 'garmin-health-1', queueRevision: 'revision-1', queueDateCreated: 100 },
    })).resolves.toBeUndefined();

    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot({ type: 'garmin_sleep_backfill' }));
    await expect(invokeWorker({ data: { queueItemId: 'garmin-health-1' } })).resolves.toBeUndefined();

    expect(hoisted.processItem).not.toHaveBeenCalled();
  });

  it('stops retries after cleanup or a durable terminal transition', async () => {
    hoisted.queueGet.mockResolvedValueOnce({ exists: false });
    hoisted.failedJobsGet.mockResolvedValueOnce({ exists: false });
    hoisted.cleanupDeleted.mockResolvedValueOnce(true);
    await expect(invokeWorker({ data: { queueItemId: 'garmin-health-1' } })).resolves.toBeUndefined();

    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot());
    hoisted.processItem.mockResolvedValueOnce('MOVED_TO_DLQ');
    await expect(invokeWorker({ data: { queueItemId: 'garmin-health-1' } })).resolves.toBeUndefined();
  });

  it('asks Cloud Tasks to retry a durably retryable transition', async () => {
    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot());
    hoisted.processItem.mockResolvedValueOnce('RETRY_INCREMENTED');

    await expect(invokeWorker({ data: { queueItemId: 'garmin-health-1' } }))
      .rejects
      .toThrow('was scheduled for retry');
  });

  it.each(['PROCESSED', 'MOVED_TO_DLQ', 'RETRY_INCREMENTED', 'FAILED'])('logs one bounded summary without changing %s acknowledgement', async result => {
    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot({ payload: 'PRIVATE_PAYLOAD', callbackURL: 'PRIVATE_CALLBACK' }));
    hoisted.processItem.mockResolvedValueOnce(result);
    const invocation = invokeWorker({ data: { queueItemId: 'PRIVATE_JOB' } });
    if (result === 'RETRY_INCREMENTED' || result === 'FAILED') await expect(invocation).rejects.toThrow();
    else await expect(invocation).resolves.toBeUndefined();
    const summaries = vi.mocked(logger.info).mock.calls.filter(([message]) => message === '[GarminHealthBackfillTaskWorker] Invocation summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0][1]).toEqual({ telemetryVersion: 1, provider: 'GarminAPI', workload: 'garmin_health_backfill',
      outcome: { PROCESSED: 'processed', MOVED_TO_DLQ: 'moved_to_dlq', RETRY_INCREMENTED: 'retry_incremented', FAILED: 'failed' }[result], durationMs: expect.any(Number) });
    expect(JSON.stringify(summaries)).not.toContain('PRIVATE');
  });

  it('expected refresh contention remains retryable but is not a processing failure', async () => {
    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot());
    const error = new Error('PRIVATE'); error.name = 'TokenRefreshInProgressError';
    hoisted.processItem.mockRejectedValueOnce(error);
    await expect(invokeWorker({ data: { queueItemId: 'garmin-health-1' } })).rejects.toBe(error);
    expect(logger.info).toHaveBeenCalledWith('[GarminHealthBackfillTaskWorker] Invocation summary', expect.objectContaining({ outcome: 'expected_contention' }));
  });

  it('a broken summary logger cannot turn a processed acknowledgement into a retry', async () => {
    hoisted.queueGet.mockResolvedValueOnce(queueSnapshot());
    hoisted.processItem.mockResolvedValueOnce('PROCESSED');
    vi.mocked(logger.info).mockImplementationOnce(() => { throw new Error('PRIVATE'); });
    await expect(invokeWorker({ data: { queueItemId: 'garmin-health-1' } })).resolves.toBeUndefined();
  });
});
