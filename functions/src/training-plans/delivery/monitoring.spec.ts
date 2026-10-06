import { afterEach, describe, expect, it, vi } from 'vitest';
import * as logger from 'firebase-functions/logger';
import { observeTrainingQueueHealth } from './monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));

function database(count: unknown, dated: unknown = null, immediate: unknown = null, createdAt = 900_000) {
  const reads: { filters: unknown[][]; mask: string[]; limit: number }[] = [];
  const db = { collection: vi.fn(() => ({
    where: (...first: unknown[]) => {
      const filters = [first]; let mask: string[] = []; let limit = 0;
      const query = {
        where: (...args: unknown[]) => { filters.push(args); return query; },
        orderBy: () => query,
        select: (...fields: string[]) => { mask = fields; return query; },
        limit: (value: number) => { limit = value; return query; },
        count: () => ({ get: async () => ({ data: () => ({ count }) }) }),
        get: async () => {
          reads.push({ filters, mask, limit });
          const value = first[1] === '>' ? dated : immediate;
          return { docs: value === null ? [] : [{
            get: () => value, createTime: { toMillis: () => createdAt },
            data: () => ({ uid: 'PRIVATE', deliveryId: 'PRIVATE' }),
          }] };
        },
      };
      return query;
    },
  })) };
  return { db: db as unknown as FirebaseFirestore.Firestore, reads };
}

describe('Training queue aggregate telemetry', () => {
  afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

  it('emits an idle heartbeat with bounded field-masked reads', async () => {
    const { db, reads } = database(0);
    await observeTrainingQueueHealth(db, 1_000_000);
    expect(reads).toEqual([
      { filters: [['dueAtMs', '>', 0], ['dueAtMs', '<=', 1_000_000]], mask: ['dueAtMs'], limit: 1 },
      { filters: [['dueAtMs', '<=', 0]], mask: ['dueAtMs'], limit: 1 },
    ]);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', {
      event: 'queue_health', telemetryVersion: 1, dueJobs: 0,
      dueAgeLowerBoundMs: 0, immediateAgeKnown: true,
    });
    expect(db.collection).toHaveBeenCalledExactlyOnceWith('trainingDeliveryQueue');
  });

  it('uses zero-marker creation time, retaining an older positive due date', async () => {
    const { db } = database(12, 200_000, 0);
    await observeTrainingQueueHealth(db, 1_000_000);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      dueJobs: 12, dueAgeLowerBoundMs: 800_000,
    }));
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('PRIVATE');
  });

  it('does not interpret an immediate marker as time since epoch', async () => {
    const { db } = database(1, null, 0);
    await observeTrainingQueueHealth(db, 1_000_000);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      dueAgeLowerBoundMs: 100_000,
    }));
  });

  it.each([Number.NaN, 1_100_000])('marks unknown immediate age (%s) without inventing elapsed time', async createdAt => {
    const { db } = database(1, null, 0, createdAt);
    await observeTrainingQueueHealth(db, 1_000_000);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      dueAgeLowerBoundMs: 0, immediateAgeKnown: false,
    }));
  });

  it('does not flag a concurrent immediate enqueue as incomplete telemetry', async () => {
    const { db } = database(1, null, 0, 1_000_100);
    await observeTrainingQueueHealth(db, 1_000_000);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      dueAgeLowerBoundMs: 0, immediateAgeKnown: true,
    }));
  });

  it('ignores stale ages when the independent count is empty', async () => {
    const { db } = database(0, 1, 0);
    await observeTrainingQueueHealth(db, 1_000_000);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      dueJobs: 0, dueAgeLowerBoundMs: 0,
    }));
  });

  it.each([
    [Number.NaN, null, null], [-1, null, null], [1.5, null, null],
    [1, Number.POSITIVE_INFINITY, null], [1, 1_000_001, null], [1, null, -1],
  ])('fails closed on malformed samples (%s, %s, %s)', async (count, dated, immediate) => {
    const { db } = database(count, dated, immediate);
    await expect(observeTrainingQueueHealth(db, 1_000_000)).resolves.toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', {
      event: 'queue_health_unavailable', telemetryVersion: 1,
    });
  });

  it('does not block dispatch when a read times out or leaks its exception', async () => {
    vi.useFakeTimers();
    const db = { collection: () => ({ where: () => ({
      count: () => ({ get: () => new Promise(() => {}) }),
    }) }) } as unknown as FirebaseFirestore.Firestore;
    // Other queries can throw synchronously too; neither escapes into dispatch.
    await expect(observeTrainingQueueHealth(db, 1_000_000)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const { db: hanging } = database(1);
    vi.spyOn(hanging, 'collection').mockImplementation(() => {
      const q = { where: () => q, orderBy: () => q, select: () => q, limit: () => q,
        count: () => q, get: () => new Promise(() => {}) };
      return q as never;
    });
    const sample = observeTrainingQueueHealth(hanging, 1_000_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(sample).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
