import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeTrainingQueueHealth } from './monitoring';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Training telemetry with isolated Firestore', () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback emulator required.');
  let db: Firestore;
  beforeEach(() => {
    vi.clearAllMocks();
    db = new Firestore({ projectId: `demo-training-monitor-${randomUUID().slice(0, 8)}` });
  });
  afterEach(async () => { await db.terminate(); });

  it('emits an empty heartbeat before any queue exists', async () => {
    await observeTrainingQueueHealth(db, Date.now());
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', {
      event: 'queue_health', telemetryVersion: 1, dueJobs: 0, dueAgeLowerBoundMs: 0, immediateAgeKnown: true,
    });
  });

  it('counts due work without future horizon work and reads zero marker last-write time', async () => {
    const now = Date.now();
    const queue = db.collection('trainingDeliveryQueue');
    await Promise.all([
      queue.doc('dated').set({ dueAtMs: now - 900_000, provider: 'garmin', uid: 'SYNTHETIC_PRIVATE' }),
      queue.doc('immediate').set({ dueAtMs: 0, kind: 'reconcile', uid: 'SYNTHETIC_PRIVATE' }),
      queue.doc('future').set({ dueAtMs: now + 3_600_000, uid: 'SYNTHETIC_PRIVATE' }),
      queue.doc('missing-date').set({ uid: 'SYNTHETIC_PRIVATE' }),
    ]);
    await observeTrainingQueueHealth(db, now + 1_000);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', {
      event: 'queue_health', telemetryVersion: 1, dueJobs: 2, dueAgeLowerBoundMs: 901_000, immediateAgeKnown: true,
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('SYNTHETIC_PRIVATE');
  });

  it('uses the latest write when a retained horizon record is made immediately due again', async () => {
    const ref = db.collection('trainingDeliveryQueue').doc('reused-reconcile');
    await ref.set({ dueAtMs: Date.now() + 3_600_000, kind: 'reconcile' });
    const created = await ref.get();
    await ref.update({ dueAtMs: 0 });
    const updated = await ref.get();
    expect(updated.createTime!.isEqual(created.createTime!)).toBe(true);
    expect(updated.updateTime!.toMillis()).toBeGreaterThanOrEqual(created.createTime!.toMillis());
    const now = updated.updateTime!.toMillis() + 900_000;
    await observeTrainingQueueHealth(db, now);
    expect(logger.info).toHaveBeenCalledWith('[TrainingDelivery]', expect.objectContaining({
      dueJobs: 1, dueAgeLowerBoundMs: 900_000, immediateAgeKnown: true,
    }));
  });

  it('reports invalid due markers as unavailable rather than an empty queue', async () => {
    await db.collection('trainingDeliveryQueue').doc('invalid').set({ dueAtMs: -1 });
    await expect(observeTrainingQueueHealth(db, Date.now())).resolves.toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[TrainingDelivery]', {
      event: 'queue_health_unavailable', telemetryVersion: 1,
    });
  });
});
