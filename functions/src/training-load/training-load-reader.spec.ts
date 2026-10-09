import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachedEffectiveTrainingLoad, defaultAppliedTrainingLoadPolicy, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { trainingLoadSourceFingerprint } from './training-load-metadata';
import { attachActivityTrainingLoad, attachEventTrainingLoads, fetchTrainingLoadMetadata } from './training-load-reader';

const cache = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn(), complete: vi.fn() }));
vi.mock('./training-load-cache', async importOriginal => ({ ...await importOriginal<any>(),
  readTrainingLoadSummaries: cache.read, refreshTrainingLoadSummary: cache.refresh, completeTrainingLoadCacheWarmup: cache.complete }));
import { summarizeTrainingLoad } from './training-load-cache';

const db = vi.hoisted(() => ({ doc: vi.fn((path: string) => ({ path })), getAll: vi.fn() }));
vi.mock('firebase-admin', () => ({ firestore: () => db }));

describe('owner Training load projections', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deduplicates exact owner paths and bounds each metadata read to 100 documents', async () => {
    db.getAll.mockImplementation(async (...refs: { path: string }[]) => refs.map(() => ({
      exists: true, data: () => ({ version: 1, controls: {}, revision: 1, excluded: false }),
    })));
    const ids = Array.from({ length: 201 }, (_, index) => `event-${index}`);
    const result = await fetchTrainingLoadMetadata('owner', [...ids, ids[0]]);
    expect(result.size).toBe(201);
    expect(db.getAll.mock.calls.map(call => call.length)).toEqual([100, 100, 1]);
    expect(db.doc.mock.calls.map(([path]) => path)).toEqual(ids.map(id => `users/owner/events/${id}/metaData/trainingLoad`));
  });

  it('warms metadata once and does not join individual event metadata on subsequent full rebuilds', async () => {
    const docs = Array.from({ length: 1001 }, (_, i) => ({ id: `event-${i}`, data: () => ({ stats: {} }) }));
    cache.read.mockResolvedValue(new Map()).mockResolvedValueOnce(null);
    db.getAll.mockImplementation(async (...refs: unknown[]) => refs.map((_, i) => ({ exists: i === 0,
      data: () => i === 0 ? { version: 1, controls: {} } : undefined })));
    await attachEventTrainingLoads('owner', docs);
    expect(db.getAll).toHaveBeenCalledTimes(11);
    expect(cache.complete).toHaveBeenCalledTimes(1);
    expect(cache.refresh).toHaveBeenCalledTimes(11);
    db.getAll.mockClear();
    await attachEventTrainingLoads('owner', docs);
    expect(db.getAll).not.toHaveBeenCalled();
  });

  it('keeps recorded statistics intact while applying per-leg controls, and rejects stale source projections', async () => {
    const parent = { startDate: 1000, endDate: 3601000, stats: { 'Training Stress Score': 87.3 } };
    const child = { ...parent, type: 'Walking', stats: { 'Training Stress Score': 87.3, Duration: 3600 } };
    const metadata: TrainingLoadMetadata = { version: 1, revision: 2, excluded: false,
      parentFingerprint: trainingLoadSourceFingerprint(parent), controls: { saved: { override: 0 } },
      legs: { saved: { activityId: 'leg', recordedTss: 87.3, evaluations: null,
        identity: { startMs: 1000, endMs: 3601000, type: 'Walking', duration: 3600, distance: null },
        policy: defaultAppliedTrainingLoadPolicy('Walking'), sourceFingerprint: trainingLoadSourceFingerprint(child) } } };
    cache.read.mockImplementation(async () => new Map([['event', summarizeTrainingLoad('event', parent, metadata)!]]));
    const [projection] = await attachEventTrainingLoads('owner', [{ id: 'event', data: () => ({ ...parent }) }]);
    expect(attachedEffectiveTrainingLoad(projection.data())).toMatchObject({ score: 0, status: 'available' });
    expect(JSON.stringify(projection.data())).toBe(JSON.stringify(parent));
    attachActivityTrainingLoad('leg', child, projection.data());
    expect(attachedEffectiveTrainingLoad(child)).toMatchObject({ score: 0, method: 'OVERRIDE' });
    const changedChild = { ...child, stats: { Duration: 3500 } };
    attachActivityTrainingLoad('leg', changedChild, projection.data());
    expect(attachedEffectiveTrainingLoad(changedChild)).toMatchObject({ score: null, reasons: ['source-updating'] });
    const [stale] = await attachEventTrainingLoads('owner', [{ id: 'event', data: () => ({ ...parent, endDate: 4000 }) }]);
    expect(attachedEffectiveTrainingLoad(stale.data())).toMatchObject({ score: null, reasons: ['source-updating'] });
    metadata.excluded = true;
    const [excluded] = await attachEventTrainingLoads('owner', [{ id: 'event', data: () => ({ ...parent, endDate: 4000 }) }]);
    expect(attachedEffectiveTrainingLoad(excluded.data())).toMatchObject({ score: 0, status: 'excluded' });
    attachActivityTrainingLoad('leg', changedChild, excluded.data());
    expect(attachedEffectiveTrainingLoad(changedChild)).toMatchObject({ score: 0, status: 'excluded' });
  });
});
