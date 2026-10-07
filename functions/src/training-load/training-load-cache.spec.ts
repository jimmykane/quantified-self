import { describe, expect, it } from 'vitest';
import { defaultAppliedTrainingLoadPolicy, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { prepareTrainingLoadCacheWrite, splitTrainingLoadBucket, summarizeTrainingLoad, trainingLoadCacheKey, trainingLoadSourceFingerprint } from './training-load-cache';

describe('compact private Training load summaries', () => {
  const parent = { stats: { 'Training Stress Score': 87 } };
  const metadata: TrainingLoadMetadata = { version: 1, revision: 2, excluded: false, controls: { leg: { override: 0 } },
    legs: { leg: { activityId: 'activity', identity: { startMs: 1, endMs: 2, duration: 1, distance: 1, type: 'Walking' },
      recordedTss: 87, evaluations: null, policy: defaultAppliedTrainingLoadPolicy('Walking'), sourceFingerprint: 'source' } } };
  it('retains zero overrides, per-leg results and source guards without private policy/candidate data', () => {
    const summary = summarizeTrainingLoad('event', parent, metadata)!;
    expect(summary.load).toMatchObject({ score: 0, status: 'available' });
    expect(summary.legs.activity).toMatchObject({ fingerprint: 'source', load: { score: 0, method: 'OVERRIDE' } });
    expect(summary.parentFingerprint).toBe(trainingLoadSourceFingerprint(parent));
    expect(summary).not.toHaveProperty('controls'); expect(summary).not.toHaveProperty('policy');
    expect(JSON.stringify(summary)).not.toContain('evaluations');
  });
  it('covers exclusion, missing legs and unmatched identities without losing zero/unavailable distinctions', () => {
    expect(summarizeTrainingLoad('e', parent, { ...metadata, excluded: true })?.missingLeg.status).toBe('excluded');
    expect(summarizeTrainingLoad('e', parent, metadata)?.missingLeg.status).toBe('unavailable');
    const unmatched = { ...metadata, legs: { leg: { ...metadata.legs!.leg, activityId: null } } };
    expect(summarizeTrainingLoad('e', parent, unmatched)?.load.reasons).toContain('activity-match-needs-review');
    expect(summarizeTrainingLoad('e', parent, null)).toBeNull();
  });
  it('skips unchanged writes even when Firestore returns map keys in a different order', async () => {
    const summary = summarizeTrainingLoad('e', parent, metadata)!;
    const reordered = Object.fromEntries(Object.entries(summary).reverse());
    let writes = 0;
    const transaction = { get: async () => ({ data: () => ({ version: 1, leaf: true,
      entries: { [trainingLoadCacheKey('e')]: reordered } }) }), set: () => { writes++; } };
    const update = await prepareTrainingLoadCacheWrite({ doc: (path: string) => path } as any, transaction as any, 'u', 'e', summary);
    expect(update.changed).toBe(false); update.write(); expect(writes).toBe(0);
  });
  it('warms interrupted imports as unavailable without blocking other workouts or losing explicit exclusion', () => {
    const pending = { ...metadata, sourceWritePending: true };
    expect(summarizeTrainingLoad('e', parent, pending)?.load).toMatchObject({ score: null, reasons: ['source-updating'] });
    expect(summarizeTrainingLoad('e', parent, { ...pending, excluded: true })?.load).toMatchObject({ score: 0, status: 'excluded' });
  });
  it('splits by encoded byte size even below the entry-count limit', () => {
    const entries = Object.fromEntries(Array.from({ length: 20 }, (_, i) => {
      const id = `large-${i}`; const summary = summarizeTrainingLoad(id, parent, metadata)!;
      summary.load.reasons = ['x'.repeat(30000)]; return [trainingLoadCacheKey(id), summary];
    }));
    const buckets = splitTrainingLoadBucket('', entries);
    expect(buckets.get('')?.leaf).toBe(false);
    expect([...buckets.values()].every(bucket => Buffer.byteLength(JSON.stringify(bucket)) <= 400000)).toBe(true);
    expect([...buckets.values()].reduce((sum, bucket) => sum + Object.keys(bucket.entries).length, 0)).toBe(20);
  });
  it('reduces 1,001 workout entries to bounded buckets and supports further splitting without dropping entries', () => {
    const roots: Record<string, Record<string, any>> = {};
    for (let i = 0; i < 1001; i++) {
      const key = trainingLoadCacheKey(`event-${i}`); (roots[key[0]] ??= {})[key] = summarizeTrainingLoad(`event-${i}`, parent, metadata)!;
    }
    const buckets = Object.entries(roots).flatMap(([prefix, entries]) => [...splitTrainingLoadBucket(prefix, entries).values()]);
    const leaves = buckets.filter(bucket => bucket.leaf);
    expect(leaves).toHaveLength(16);
    expect(leaves.reduce((sum, bucket) => sum + Object.keys(bucket.entries).length, 0)).toBe(1001);
    const all = Object.assign({}, ...Object.values(roots));
    const split = splitTrainingLoadBucket('', all);
    expect(split.get('')?.leaf).toBe(false);
    expect([...split.values()].filter(bucket => bucket.leaf).every(bucket => Object.keys(bucket.entries).length <= 100)).toBe(true);
  });
});
