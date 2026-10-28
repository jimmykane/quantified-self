import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), deleted: false, db: null as any }));
vi.mock('firebase-admin', () => ({ firestore: () => state.db }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } }));
vi.mock('../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: async () => ({ shouldSkip: state.deleted }) }));
import { DataPause, EventImporterJSON } from '@sports-alliance/sports-lib';
import { defaultAppliedTrainingLoadPolicy, resolveEffectiveTrainingLoad, type TrainingLoadMetadata } from '../../../shared/training-load-policy';
import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { trainingLoadSourceFingerprint } from '../training-load/training-load-cache';
import { mergeRecordedEvents, mergedActivityId } from './merge-recorded-events';
import { mergedTrainingLoadLegs, prepareMergedTrainingLoad, type MergeTrainingLoadSource } from './merge-training-load';

const base = 'users/u';
const resultPath = `${base}/events/merged`;
const metadataPath = `${resultPath}/metaData/trainingLoad`;
const reference = (path: string): any => ({ path, id: path.split('/').pop(), collection: (child: string) => collection(`${path}/${child}`) });
const collection = (path: string): any => ({ path, doc: (id: string) => reference(`${path}/${id}`),
  where: (field: string, _op: string, value: unknown) => ({ path, field, value, limit: (limit: number) => ({ path, field, value, limit }) }) });
const snapshot = (path: string, data: unknown): any => ({ id: path.split('/').pop(), exists: data !== undefined,
  data: () => data, updateTime: { seconds: 100, nanoseconds: 0 } });

function source(id: string, score = 100, method = 'POWER', type = 'Cycling') {
  const event = EventImporterJSON.getEventFromJSON({ name: 'Source', startDate: 1000, endDate: 3601000,
    activities: [{ startDate: 1000, endDate: 3601000, type, creator: { name: 'Test' },
      laps: [], intensityZones: [], streams: [], stats: { Duration: 3600, [DataPause.type]: 0, Distance: 10000, Energy: 210, Weight: 70,
        'Training Stress Score': score, 'Training Stress Score Method': method } }] } as any).setID(id);
  event.getFirstActivity().setID('leg');
  const data = sanitizeActivityFirestoreWritePayload(event.getFirstActivity().toJSON()) as unknown as Record<string, unknown>;
  const item: MergeTrainingLoadSource = { eventId: id, parent: sanitizeEventFirestoreWritePayload(event.toJSON()) as unknown as Record<string, unknown>,
    activities: [{ id: 'leg', data }] };
  const result = { score, method: method as any, estimated: false, reasons: [], provenance: method === 'IMPORTED' ? 'imported' : 'calculated' };
  const metadata: TrainingLoadMetadata = { version: 1, revision: 7, excluded: false, controls: {},
    parentFingerprint: trainingLoadSourceFingerprint(item.parent), legs: { old: { activityId: 'leg',
      identity: { startMs: 1000, endMs: 3601000, type, duration: 3600, distance: 10000 },
      recordedTss: score, evaluations: { automatic: result, hr: result, met: result } as any,
      policy: { ...defaultAppliedTrainingLoadPolicy(type), revision: 4, effectiveAtMs: 500, method: 'HR' },
      sourceFingerprint: trainingLoadSourceFingerprint(data) } } };
  return { event, item, metadata };
}
function putSource(record: ReturnType<typeof source>) {
  const { item, metadata } = record;
  // IDs are globally unique in production; use distinct source IDs in integration fixtures too.
  const childId = `${item.eventId}-leg`;
  record.event.getFirstActivity().setID(childId); item.activities[0].id = childId;
  metadata.legs!.old.activityId = childId;
  state.docs.set(`${base}/events/${item.eventId}`, item.parent);
  state.docs.set(`${base}/events/${item.eventId}/metaData/trainingLoad`, metadata);
  state.docs.set(`${base}/activities/${childId}`, { ...item.activities[0].data, eventID: item.eventId });
}
function persist(event: ReturnType<typeof mergeRecordedEvents>) {
  state.docs.set(resultPath, sanitizeEventFirestoreWritePayload(event.toJSON()));
  event.getActivities().forEach(activity => state.docs.set(`${base}/activities/${activity.getID()}`,
    { ...sanitizeActivityFirestoreWritePayload(activity.toJSON()), eventID: 'merged' }));
}

beforeEach(() => {
  state.docs.clear(); state.deleted = false;
  state.db = { doc: reference, collection,
    runTransaction: async (callback: any) => {
      const writes: Array<() => void> = [];
      const get = async (ref: any) => {
        if (ref.field) {
          const docs = [...state.docs].filter(([path, data]) => path.startsWith(`${ref.path}/`) &&
            path.split('/').length === ref.path.split('/').length + 1 && data[ref.field] === ref.value)
            .slice(0, ref.limit).map(([path, data]) => snapshot(path, data));
          return { size: docs.length, docs };
        }
        return snapshot(ref.path, state.docs.get(ref.path));
      };
      const transaction = { get, getAll: (...refs: any[]) => Promise.all(refs.map(get)),
        set: (ref: any, data: any) => writes.push(() => state.docs.set(ref.path, structuredClone(data))),
        delete: (ref: any) => writes.push(() => state.docs.delete(ref.path)) };
      const value = await callback(transaction); writes.forEach(write => write()); return value;
    } };
});

describe('merge Training load snapshots', () => {
  it('copies candidates and frozen policy, preserves override zero and translates whole-source exclusion per leg', () => {
    const a = source('a'), b = source('b', 0, 'IMPORTED'), c = source('c');
    a.metadata.controls.old = { override: 0 }; b.metadata.excluded = true;
    c.metadata.legs!.old.policy.included = false;
    const copied = mergedTrainingLoadLegs('merged', [a, b, c].map(record => ({ ...record.item, metadata: record.metadata })));
    const metadata = { version: 1, revision: 1, excluded: false, ...copied } as TrainingLoadMetadata;
    expect(resolveEffectiveTrainingLoad({ stats: { 'Training Stress Score': 999 } }, metadata)).toMatchObject({ score: 0, status: 'available' });
    expect(copied.legs![mergedActivityId('merged', 'a', 'leg')].policy).toEqual(a.metadata.legs!.old.policy);
    expect(copied.controls[mergedActivityId('merged', 'b', 'leg')]).toEqual({ included: false });
    expect(a.metadata.controls.old).toEqual({ override: 0 });
  });
  it('sums included legs once and keeps imported zero, without distributing a parent-only score', () => {
    const a = source('a'), b = source('b', 0, 'IMPORTED');
    const copied = mergedTrainingLoadLegs('merged', [a, b].map(record => ({ ...record.item, metadata: record.metadata })));
    expect(resolveEffectiveTrainingLoad({ stats: { 'Training Stress Score': 200 } }, { version: 1, revision: 1, excluded: false, ...copied })).toMatchObject({ score: 100 });
    delete (a.item.activities[0].data.stats as Record<string, unknown>)['Training Stress Score'];
    const legacy = mergedTrainingLoadLegs('merged', [{ ...a.item, parent: { stats: { 'Training Stress Score': 200 } }, metadata: null }]);
    expect(legacy.legs![mergedActivityId('merged', 'a', 'leg')]).toMatchObject({ evaluations: null, recordedTss: null, policy: { method: 'AUTOMATIC', included: true } });
  });
  it('copies resolved association policy and method separately from recorded and automatic scores', () => {
    const a = source('a');
    const original = a.metadata.legs!.old;
    a.metadata.legs!.old = { ...original, activityId: null };
    a.metadata.legs!.current = { ...original, policy: { ...original.policy, method: 'MET', revision: 8 },
      evaluations: { automatic: { score: 100, method: 'POWER', estimated: false, reasons: [] },
        hr: { score: 7.6, method: 'HR', estimated: false, reasons: [] },
        met: { score: 9, method: 'MET', estimated: true, reasons: [] } } as any };
    a.metadata.controls.old = { activityId: 'leg', method: 'MET' };
    const copied = mergedTrainingLoadLegs('merged', [{ ...a.item, metadata: a.metadata }]);
    const metadata: TrainingLoadMetadata = { version: 1, revision: 1, excluded: false, ...copied };
    const id = mergedActivityId('merged', 'a', 'leg');
    expect(copied.legs![id]).toMatchObject({ recordedTss: 100, policy: { revision: 4, method: 'HR' } });
    expect(copied.controls[id]).toEqual({ method: 'MET' });
    expect(resolveEffectiveTrainingLoad({}, metadata).score).toBe(9);
    metadata.controls = {};
    expect(resolveEffectiveTrainingLoad({}, metadata).score).toBe(7.6);
  });
  it('requires a reassociated CSS candidate to be refreshed before merging, except imported scores', () => {
    const a = source('a', 100, 'SWIM_PACE', 'Swimming');
    const original = a.metadata.legs!.old;
    original.policy = { ...original.policy, family: 'swimming', method: 'SWIM_PACE', swimThresholdSpeed: 1 };
    a.metadata.legs!.current = { ...original, policy: { ...original.policy, swimThresholdSpeed: 2 } };
    a.metadata.legs!.old = { ...original, activityId: null };
    a.metadata.controls.old = { activityId: 'leg', override: 0 };
    expect(() => mergedTrainingLoadLegs('merged', [{ ...a.item, metadata: a.metadata }])).toThrow(/review/);
    // Once source reparse refreshes the candidate for the retained policy, merge is valid.
    a.metadata.legs!.current.policy.swimThresholdSpeed = 1;
    expect(mergedTrainingLoadLegs('merged', [{ ...a.item, metadata: a.metadata }]).legs![mergedActivityId('merged', 'a', 'leg')].policy.swimThresholdSpeed).toBe(1);
    a.metadata.legs!.current.policy.swimThresholdSpeed = 2;
    const imported = { preference: 'AUTOMATIC' as const, score: 0, method: 'IMPORTED' as const,
      provenance: 'imported' as const, estimated: false, reasons: ['imported-score' as const] };
    a.metadata.legs!.current.evaluations = { version: 1, automatic: imported, hr: { ...imported, preference: 'HR' },
      met: { ...imported, preference: 'MET' }, swimPace: { ...imported, preference: 'SWIM_PACE' } };
    delete a.metadata.controls.old.override;
    expect(resolveEffectiveTrainingLoad({}, a.metadata).score).toBe(0);
    const copied = mergedTrainingLoadLegs('merged', [{ ...a.item, metadata: a.metadata }]);
    expect(resolveEffectiveTrainingLoad({}, { version: 1, revision: 1, excluded: false, ...copied }).score).toBe(0);
  });
  it('refuses legacy controls with no corresponding source activity instead of dropping them', () => {
    const a = source('a'); delete a.metadata.legs;
    a.metadata.controls = { gone: { override: 0 } };
    expect(() => mergedTrainingLoadLegs('merged', [{ ...a.item, metadata: a.metadata }])).toThrow(/changed|review/);
  });
  it.each(['pending', 'unresolved', 'stale-parent', 'stale-child', 'missing-leg'])('rejects %s metadata without guessing', mode => {
    const a = source('a');
    if (mode === 'pending') a.metadata.sourceWritePending = true;
    if (mode === 'unresolved') a.metadata.legs!.old.activityId = null;
    if (mode === 'stale-parent') a.metadata.parentFingerprint = 'different';
    if (mode === 'stale-child') a.metadata.legs!.old.sourceFingerprint = 'different';
    if (mode === 'missing-leg') a.metadata.legs = {};
    expect(() => mergedTrainingLoadLegs('merged', [{ ...a.item, metadata: a.metadata }])).toThrow(/changed|review/);
  });
});

describe('merge metadata coordination', () => {
  it.each(['pending', 'completed'])('rejects an older merge finalizer after a newer attempt is %s', async phase => {
    const a = source('a'), b = source('b'); putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    const finishOlder = await prepareMergedTrainingLoad('u', merged, [a.item, b.item]);
    persist(merged);
    const finishNewer = await prepareMergedTrainingLoad('u', merged, [a.item, b.item]);
    if (phase === 'completed') await finishNewer();
    const before = structuredClone(state.docs.get(metadataPath));
    await expect(finishOlder()).rejects.toThrow(/changed|review|superseded/);
    expect(state.docs.get(metadataPath)).toEqual(before);
    if (phase === 'pending') await finishNewer();
    expect(resolveEffectiveTrainingLoad(merged, state.docs.get(metadataPath))).toMatchObject({ score: 200, status: 'available' });
  });
  it('stages unavailable, publishes correct total/cache, and preserves a concurrent result override', async () => {
    const a = source('a'), b = source('b'); putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    const finish = await prepareMergedTrainingLoad('u', merged, [a.item, b.item]);
    expect(state.docs.get(metadataPath).sourceWritePending).toBe(true);
    expect(resolveEffectiveTrainingLoad({}, state.docs.get(metadataPath)).score).toBeNull();
    persist(merged);
    const metadata = state.docs.get(metadataPath);
    const id = merged.getFirstActivity().getID()!;
    metadata.controls[id] = { override: 0 }; metadata.revision++;
    await finish();
    const saved = state.docs.get(metadataPath);
    expect(saved).toMatchObject({ sourceWritePending: false, controls: { [id]: { override: 0 } } });
    expect(resolveEffectiveTrainingLoad(merged, saved)).toMatchObject({ score: 100, status: 'available' });
    const caches = [...state.docs].filter(([path]) => path.includes('/trainingLoadCache/b_'));
    expect(Object.values(caches[0][1].entries)[0]).toMatchObject({ load: { score: 100 } });
    const before = structuredClone(saved); await finish(); expect(state.docs.get(metadataPath)).toEqual(before);
  });
  it('retries a preparation-only failure with stable IDs, original frozen policy and latest target controls', async () => {
    const a = source('a'), b = source('b'); putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    await prepareMergedTrainingLoad('u', merged, [a.item, b.item]);
    const id = merged.getFirstActivity().getID()!;
    state.docs.get(metadataPath).controls[id] = { override: 0 };
    a.metadata.legs!.old.policy = { ...a.metadata.legs!.old.policy, revision: 20, included: false };
    a.metadata.controls.old = { override: 999 };
    const finish = await prepareMergedTrainingLoad('u', merged, [a.item, b.item]);
    persist(merged); await finish();
    expect(state.docs.get(metadataPath).legs[id].policy.revision).toBe(4);
    expect(state.docs.get(metadataPath).controls[id]).toEqual({ override: 0 });
    expect(resolveEffectiveTrainingLoad(merged, state.docs.get(metadataPath)).score).toBe(100);
  });
  it('keeps frozen CSS and its candidates together when the source calibration changes before a merge retry', async () => {
    const a = source('a', 100, 'SWIM_PACE', 'Swimming'), b = source('b');
    a.metadata.legs!.old.policy = { ...a.metadata.legs!.old.policy, family: 'swimming', swimThresholdSpeed: 1 };
    putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    await prepareMergedTrainingLoad('u', merged, [a.item, b.item]);
    const id = mergedActivityId('merged', 'a', 'a-leg');
    const frozen = structuredClone(state.docs.get(metadataPath).legs[id]);
    a.metadata.legs!.old.policy.swimThresholdSpeed = 2;
    for (const candidate of Object.values(a.metadata.legs!.old.evaluations!)) {
      if (candidate && typeof candidate === 'object' && 'score' in candidate) candidate.score = 12.5;
    }
    const finish = await prepareMergedTrainingLoad('u', merged, [a.item, b.item]);
    persist(merged); await finish();
    const retained = state.docs.get(metadataPath).legs[id];
    expect(retained.policy).toEqual(frozen.policy);
    expect(retained.evaluations).toEqual(frozen.evaluations);
    expect(resolveEffectiveTrainingLoad(merged, state.docs.get(metadataPath)).score).toBe(200);
  });
  it('does not reuse frozen CSS candidates for different source data after a preparation-only failure', async () => {
    const a = source('a', 100, 'SWIM_PACE', 'Swimming'), b = source('b');
    a.metadata.legs!.old.policy.swimThresholdSpeed = 1;
    putSource(a); putSource(b);
    await prepareMergedTrainingLoad('u', mergeRecordedEvents([a.event, b.event], 'merged'), [a.item, b.item]);
    const before = structuredClone(state.docs.get(metadataPath));
    const updated = source('a', 200, 'SWIM_PACE', 'Swimming');
    updated.metadata.legs!.old.policy.swimThresholdSpeed = 2;
    putSource(updated);
    await expect(prepareMergedTrainingLoad('u', mergeRecordedEvents([updated.event, b.event], 'merged'),
      [updated.item, b.item])).rejects.toThrow(/changed|review/);
    expect(state.docs.get(metadataPath)).toEqual(before);
  });
  it.each(['source-parent', 'source-child', 'extra-child', 'missing-parent'])('fails before preparation writes after %s changes', async mode => {
    const a = source('a'), b = source('b'); putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    if (mode === 'source-parent') state.docs.set(`${base}/events/a`, { ...a.item.parent, stats: { Energy: 999 } });
    if (mode === 'source-child') state.docs.set(`${base}/activities/a-leg`, { ...a.item.activities[0].data, eventID: 'a', stats: { Energy: 999 } });
    if (mode === 'extra-child') state.docs.set(`${base}/activities/extra`, { ...a.item.activities[0].data, eventID: 'a' });
    if (mode === 'missing-parent') state.docs.delete(`${base}/events/a`);
    await expect(prepareMergedTrainingLoad('u', merged, [a.item, b.item])).rejects.toThrow(/changed|review/);
    expect(state.docs.has(metadataPath)).toBe(false);
  });
  it.each(['legacy-reference', 'array-reference', 'generation', 'file-order'])('rejects changed %s before copying load metadata', async mode => {
    const a = source('a'), b = source('b');
    const first = { path: 'original-a.fit', generation: '1', startDate: new Date(1000) };
    const second = { path: 'original-b.fit', generation: '2', startDate: new Date(2000) };
    a.item.parent.originalFile = first; a.item.parent.originalFiles = [first, second];
    putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    const changed = { ...a.item.parent };
    if (mode === 'legacy-reference') changed.originalFile = { ...first, path: 'replaced.fit' };
    if (mode === 'array-reference') changed.originalFiles = [{ ...first, path: 'replaced.fit' }, second];
    if (mode === 'generation') changed.originalFiles = [{ ...first, generation: '9' }, second];
    if (mode === 'file-order') changed.originalFiles = [second, first];
    state.docs.set(`${base}/events/a`, changed);
    await expect(prepareMergedTrainingLoad('u', merged, [a.item, b.item])).rejects.toThrow(/changed|review/);
    expect(state.docs.has(metadataPath)).toBe(false);
  });
  it('accepts equivalent Timestamp instances, Date values and map key ordering for original files', async () => {
    const a = source('a'), b = source('b');
    a.item.parent.originalFiles = [{ path: 'original.fit', bucket: 'private', startDate: new Date(1000) }];
    putSource(a); putSource(b);
    state.docs.set(`${base}/events/a`, { ...a.item.parent, originalFiles: [{
      startDate: { seconds: 1, nanoseconds: 0, toMillis: () => 1000 }, bucket: 'private', path: 'original.fit' }] });
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    await expect(prepareMergedTrainingLoad('u', merged, [a.item, b.item])).resolves.toBeTypeOf('function');
    expect(state.docs.get(metadataPath).sourceWritePending).toBe(true);
  });
  it.each(['target-parent', 'target-child', 'deleted-user'])('keeps pending when %s changes before finalization', async mode => {
    const a = source('a'), b = source('b'); putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    const finish = await prepareMergedTrainingLoad('u', merged, [a.item, b.item]); persist(merged);
    if (mode === 'target-parent') state.docs.set(resultPath, { stats: { Energy: 999 } });
    if (mode === 'target-child') state.docs.delete(`${base}/activities/${merged.getFirstActivity().getID()}`);
    if (mode === 'deleted-user') state.deleted = true;
    await expect(finish()).rejects.toThrow();
    expect(state.docs.get(metadataPath).sourceWritePending).toBe(true);
  });
  it('does not overwrite a result changed by another source rewrite before retry', async () => {
    const a = source('a'), b = source('b'); putSource(a); putSource(b);
    const merged = mergeRecordedEvents([a.event, b.event], 'merged');
    await prepareMergedTrainingLoad('u', merged, [a.item, b.item]); persist(merged);
    state.docs.set(resultPath, { ...state.docs.get(resultPath), stats: { Energy: 999 } });
    await expect(prepareMergedTrainingLoad('u', merged, [a.item, b.item])).rejects.toThrow(/changed|review/);
    expect(state.docs.get(resultPath).stats).toEqual({ Energy: 999 });
  });
  it('checks deletion before preparation writes', async () => {
    const a = source('a'), b = source('b'); putSource(a); putSource(b); state.deleted = true;
    await expect(prepareMergedTrainingLoad('u', mergeRecordedEvents([a.event, b.event], 'merged'), [a.item, b.item])).rejects.toThrow(/deletion/);
    expect(state.docs.has(metadataPath)).toBe(false);
  });
});
