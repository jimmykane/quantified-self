import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.unmock('firebase-admin');
vi.unmock('@sports-alliance/sports-lib');
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ActivityTypes, ActivityUtilities, EventImporterJSON, type EventInterface } from '@sports-alliance/sports-lib';
import { persistTrainingLoadMetadata, prepareTrainingLoadMetadata } from './training-load-metadata';
import { completeTrainingLoadCacheWarmup, prepareTrainingLoadCacheWrite, readTrainingLoadSummaries, refreshTrainingLoadSummary, splitTrainingLoadBucket, summarizeTrainingLoad, trainingLoadCacheKey } from './training-load-cache';
import { attachEventTrainingLoads } from './training-load-reader';
import { attachedEffectiveTrainingLoad, resolveEffectiveTrainingLoad, type TrainingLoadMetadata } from '../../../shared/training-load-policy';

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!enabled)('Training load persistence in Firestore', () => {
  let db: admin.firestore.Firestore;
  const users: string[] = [];
  function setup() {
    if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-walking-tss' });
    db = admin.firestore();
    const uid = `load-${randomUUID()}`; users.push(uid); return uid;
  }
  function workout(id = 'leg', start = Date.UTC(2026, 0, 2)) {
    const event = EventImporterJSON.getEventFromJSON({ name: 'Walk', startDate: start, endDate: start + 3600000,
      activities: [{ startDate: start, endDate: start + 3600000, type: ActivityTypes.Walking,
        creator: { name: 'Test' }, laps: [], intensityZones: [], streams: [], stats: { Energy: 210, Weight: 70 } }] } as any);
    event.setID('workout'); const activity = event.getActivities()[0]; activity.setID(id);
    ActivityUtilities.generateMissingStreamsAndStatsForActivity(activity);
    return event;
  }
  async function source(uid: string, event: EventInterface) {
    await db.doc(`users/${uid}`).set({ test: true });
    const json = JSON.parse(JSON.stringify(sanitizeEventFirestoreWritePayload(event.toJSON()))); delete json.activities;
    await db.doc(`users/${uid}/events/workout`).set(json);
    for (const activity of event.getActivities()) {
      const data = JSON.parse(JSON.stringify(sanitizeActivityFirestoreWritePayload(activity.toJSON()))); delete data.streams;
      await db.doc(`users/${uid}/activities/${activity.getID()}`).set({ ...data, eventID: 'workout' });
    }
  }
  const metadataPath = (uid: string) => `users/${uid}/events/workout/metaData/trainingLoad`;
  afterAll(async () => {
    if (!db) return;
    for (const uid of users) {
      await db.recursiveDelete(db.doc(`users/${uid}`));
      await db.doc(`userDeletionTombstones/${uid}`).delete();
    }
    await db.terminate();
  });
  it('commits pending and final load together, skips identical refreshes, and reuses matched policy history', async () => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    const event = workout(); const finish = await prepareTrainingLoadMetadata(uid, event);
    expect((await db.doc(metadataPath(uid)).get()).data()?.sourceWritePending).toBe(true);
    await source(uid, event);
    const [pending] = await attachEventTrainingLoads(uid, [await db.doc(`users/${uid}/events/workout`).get()]);
    expect(attachedEffectiveTrainingLoad(pending.data()!)).toMatchObject({ score: null, reasons: ['source-updating'] });
    await finish();
    const first = (await db.doc(metadataPath(uid)).get()).data()!;
    expect(first).toMatchObject({ sourceWritePending: false, sourceRevision: 1 });
    const bucket = db.doc(`users/${uid}/trainingLoadCache/b_${trainingLoadCacheKey('workout')[0]}`);
    const cachedTime = (await bucket.get()).updateTime;
    await persistTrainingLoadMetadata(uid, event);
    expect((await bucket.get()).updateTime?.isEqual(cachedTime!)).toBe(true);
    const originalTransaction = db.runTransaction.bind(db);
    let policyQueries = 0;
    const policyQuery = db.collection(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions`)
      .where('effectiveAt', '<=', Timestamp.fromMillis(event.startDate.getTime())).orderBy('effectiveAt', 'desc').limit(1);
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation(((update: any, options: any) => originalTransaction(async transaction => {
      const get = transaction.get.bind(transaction);
      vi.spyOn(transaction, 'get').mockImplementation(((ref: any) => {
        if (typeof ref.isEqual === 'function' && ref instanceof admin.firestore.Query && ref.isEqual(policyQuery)) policyQueries++;
        return get(ref);
      }) as any);
      return update(transaction);
    }, options)) as any);
    try {
      const duplicate = await prepareTrainingLoadMetadata(uid, event);
      await source(uid, event); await duplicate();
    } finally { spy.mockRestore(); }
    expect(policyQueries).toBe(0);
    expect((await bucket.get()).updateTime?.isEqual(cachedTime!)).toBe(false);
    expect((await db.doc(metadataPath(uid)).get()).data()?.loadRevision).toBe(first.loadRevision + 1);
    expect((await db.doc(metadataPath(uid)).get()).data()?.updatedAt.toMillis()).toBeGreaterThan(first.updatedAt.toMillis());
    expect((await db.doc(metadataPath(uid)).get()).data()?.sourceRevision).toBe(first.sourceRevision);
    const [projection] = await attachEventTrainingLoads(uid, [await db.doc(`users/${uid}/events/workout`).get()]);
    expect(attachedEffectiveTrainingLoad(projection.data()!)?.score).toBe(9);
  });

  it('does not reserve a pending import when candidate evaluation fails', async () => {
    const uid = setup(); const event = workout(); await source(uid, event); await persistTrainingLoadMetadata(uid, event);
    const before = (await db.doc(metadataPath(uid)).get()).data();
    const evaluate = vi.spyOn(ActivityUtilities, 'getTrainingStressScoreEvaluations').mockImplementationOnce(() => { throw new Error('invalid input'); });
    try { await expect(prepareTrainingLoadMetadata(uid, event)).rejects.toThrow('invalid input'); }
    finally { evaluate.mockRestore(); }
    expect((await db.doc(metadataPath(uid)).get()).data()).toEqual(before);
  });

  it('invalidates and caches a control edit made during an otherwise unchanged reimport', async () => {
    const uid = setup(); const event = workout(); await source(uid, event); await persistTrainingLoadMetadata(uid, event);
    const ref = db.doc(metadataPath(uid)); const before = (await ref.get()).data()!;
    const finish = await prepareTrainingLoadMetadata(uid, event); await source(uid, event);
    await ref.update({ controls: { leg: { override: 0 } }, revision: before.revision + 2 });
    await refreshTrainingLoadSummary(uid, 'workout');
    await finish();
    const after = (await ref.get()).data()!;
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(after.loadRevision).toBe(before.loadRevision + 1);
    await completeTrainingLoadCacheWarmup(uid);
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.score).toBe(0);
  });

  it('applies exclusion and reset while an interrupted source import remains pending', async () => {
    const uid = setup(); const event = workout(); await source(uid, event); await persistTrainingLoadMetadata(uid, event);
    await completeTrainingLoadCacheWarmup(uid);
    const finish = await prepareTrainingLoadMetadata(uid, event);
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: null, reasons: ['source-updating'] });
    const ref = db.doc(metadataPath(uid));
    await ref.update({ excluded: true }); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 0, status: 'excluded' });
    await ref.update({ excluded: false, controls: {} }); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: null, reasons: ['source-updating'] });
    await source(uid, event); await finish();
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 9, status: 'available' });
  });

  it('refreshes current owner edits, reset and deletion without trusting delayed trigger contents', async () => {
    const uid = setup(); const event = workout(); await source(uid, event); await persistTrainingLoadMetadata(uid, event);
    const parent = db.doc(`users/${uid}/events/workout`); const metadata = db.doc(metadataPath(uid));
    await attachEventTrainingLoads(uid, [await parent.get()]);
    await metadata.update({ controls: { leg: { override: 0 } }, revision: 2 });
    await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 0, status: 'available' });
    await metadata.update({ excluded: true, revision: 3 });
    await Promise.all([refreshTrainingLoadSummary(uid, 'workout'), refreshTrainingLoadSummary(uid, 'workout')]);
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.status).toBe('excluded');
    await metadata.update({ excluded: false, controls: {}, revision: 4 }); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.score).toBe(9);
    await parent.delete(); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.has('workout')).toBe(false);
    expect((await db.collection(`users/${uid}/trainingLoadCache`).where('leaf', '==', true).get()).empty).toBe(true);
    await source(uid, event); await persistTrainingLoadMetadata(uid, event);
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.score).toBe(9);
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await Promise.all([refreshTrainingLoadSummary(uid, 'workout'), completeTrainingLoadCacheWarmup(uid)]);
    expect((await db.collection(`users/${uid}/trainingLoadCache`).get()).empty).toBe(true);
  });

  it('refreshes legacy multisport controls against corrected recorded sources and deleted legs', async () => {
    const uid = setup(); const event = workout(); await source(uid, event);
    await db.doc(`users/${uid}/activities/leg`).update({ 'stats.Training Stress Score': 50 });
    await db.doc(`users/${uid}/activities/second`).set({ eventID: 'workout', type: 'Cycling', stats: { 'Training Stress Score': 70 } });
    await db.doc(metadataPath(uid)).set({ version: 1, revision: 1, excluded: false, controls: { leg: { override: 0 } } });
    const parent = db.doc(`users/${uid}/events/workout`);
    const [first] = await attachEventTrainingLoads(uid, [await parent.get()]);
    expect(attachedEffectiveTrainingLoad(first.data()!)?.score).toBe(70);
    await db.doc(`users/${uid}/activities/second`).update({ 'stats.Training Stress Score': 90 });
    await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.score).toBe(90);
    await db.doc(`users/${uid}/activities/second`).delete(); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.score).toBe(0);
  });

  it('splits full buckets atomically under concurrent writes and reads 1,001 summaries in 17 billed document reads', async () => {
    const uid = setup(); const event = workout(); await source(uid, event); await persistTrainingLoadMetadata(uid, event);
    const metadata = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
    const parent = (await db.doc(`users/${uid}/events/workout`).get()).data()!;
    const roots: Record<string, Record<string, any>> = {};
    for (let i = 0; i < 1001; i++) {
      const id = `event-${i}`; const key = trainingLoadCacheKey(id);
      (roots[key[0]] ??= {})[key] = summarizeTrainingLoad(id, parent, metadata)!;
    }
    const batch = db.batch();
    for (const [prefix, entries] of Object.entries(roots)) for (const [id, bucket] of splitTrainingLoadBucket(prefix, entries))
      batch.set(db.doc(`users/${uid}/trainingLoadCache/b_${id}`), bucket);
    await batch.commit(); await completeTrainingLoadCacheWarmup(uid);
    let reads = 0;
    const countedDb = { doc: (path: string) => ({ get: async () => { reads++; return db.doc(path).get(); } }),
      collection: (path: string) => ({ where: (...args: [string, admin.firestore.WhereFilterOp, unknown]) => ({ get: async () => {
        const snapshot = await db.collection(path).where(...args).get(); reads += Math.max(1, snapshot.size); return snapshot;
      } }) }) };
    expect((await readTrainingLoadSummaries(uid, countedDb as any))?.size).toBe(1001);
    expect(reads).toBe(17);
    const ids: string[] = [];
    for (let i = 0; ids.length < 102; i++) if (trainingLoadCacheKey(`split-${i}`)[0] === 'a') ids.push(`split-${i}`);
    await db.doc(`users/${uid}/trainingLoadCache/b_a`).set({ version: 1, leaf: true,
      entries: Object.fromEntries(ids.slice(0, 100).map(id => [trainingLoadCacheKey(id), summarizeTrainingLoad(id, parent, metadata)])) });
    await Promise.all(ids.slice(100).map(id => db.runTransaction(async transaction => {
      const write = await prepareTrainingLoadCacheWrite(db, transaction, uid, id, summarizeTrainingLoad(id, parent, metadata)); write.write();
    })));
    const summaries = await readTrainingLoadSummaries(uid);
    expect(ids.every(id => summaries?.has(id))).toBe(true);
    expect((await db.doc(`users/${uid}/trainingLoadCache/b_a`).get()).data()?.leaf).toBe(false);
  });

  it('selects dated defaults for a delayed import, caches MET, and preserves policy and current controls on duplicate/reparse', async () => {
    const uid = setup(); const event = workout(); await source(uid, event);
    const revisions = db.collection(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions`);
    await revisions.doc('past').set({ revision: 1, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)), method: 'HR', included: true });
    await revisions.doc('future').set({ revision: 2, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 3)), method: 'MET', included: false });
    await persistTrainingLoadMetadata(uid, event);
    const ref = db.doc(metadataPath(uid));
    const first = (await ref.get()).data() as TrainingLoadMetadata;
    expect(first.legs!.leg).toMatchObject({ policy: { revision: 1, method: 'HR', included: true },
      evaluations: { automatic: { score: 9, method: 'MET' }, hr: { score: 9, reasons: ['missing-hr-calibration'] } } });
    await persistTrainingLoadMetadata(uid, event);
    expect((await ref.get()).data()?.revision).toBe(1);
    expect((await ref.get()).data()?.updatedAt.toMillis()).toBe((first.updatedAt as Timestamp).toMillis());
    await ref.update({ controls: { leg: { override: 0 } }, revision: 2 });
    const changed = workout('new'); await source(uid, changed); await persistTrainingLoadMetadata(uid, changed);
    expect((await ref.get()).data()).toMatchObject({ revision: 3, controls: { leg: { override: 0 } },
      legs: { leg: { activityId: 'new', policy: { revision: 1 } } } });
    const docs = await attachEventTrainingLoads(uid, [(await db.doc(`users/${uid}/events/workout`).get())]);
    expect(attachedEffectiveTrainingLoad(docs[0].data()!)).toMatchObject({ score: 0, status: 'available' });
  });
  it('preserves edits committed after the parser starts and blocks deleted owners and mismatched source data', async () => {
    const uid = setup(); const event = workout(); await source(uid, event); await persistTrainingLoadMetadata(uid, event);
    await db.doc(metadataPath(uid)).update({ excluded: true, revision: 2 });
    await persistTrainingLoadMetadata(uid, event);
    expect((await db.doc(metadataPath(uid)).get()).data()?.excluded).toBe(true);
    await db.doc(`users/${uid}/activities/leg`).update({ 'stats.Energy': 999 });
    await expect(persistTrainingLoadMetadata(uid, event)).rejects.toThrow('source changed');
    await source(uid, event);
    await db.doc(`userDeletionTombstones/${uid}`).set({ deleting: true });
    await expect(persistTrainingLoadMetadata(uid, event)).rejects.toThrow('account deletion');
  });
  it('serializes concurrent owner edits and source reparses without losing the override', async () => {
    const uid = setup(); const original = workout(); await source(uid, original);
    await persistTrainingLoadMetadata(uid, original);
    const changed = workout('new-leg'); await source(uid, changed);
    const ref = db.doc(metadataPath(uid));
    await Promise.all([
      persistTrainingLoadMetadata(uid, changed),
      db.runTransaction(async transaction => {
        const current = (await transaction.get(ref)).data()!;
        transaction.update(ref, { controls: { leg: { override: 12.3 } }, revision: current.revision + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }),
    ]);
    expect((await ref.get()).data()).toMatchObject({ revision: 3, controls: { leg: { override: 12.3 } },
      legs: { leg: { activityId: 'new-leg', policy: { revision: 0 } } } });
  });
  it('freezes legacy identity before reused IDs are overwritten and retains it through partial-write retries', async () => {
    const uid = setup(); const original = workout(); await source(uid, original);
    const ref = db.doc(metadataPath(uid));
    await ref.set({ version: 1, revision: 1, excluded: false, controls: { leg: { override: 12.3 } },
      updatedAt: Timestamp.fromMillis(1000) });
    const changed = workout(); changed.getActivities()[0].type = ActivityTypes.Cycling;
    await prepareTrainingLoadMetadata(uid, changed);
    const prepared = (await ref.get()).data() as TrainingLoadMetadata;
    expect(prepared.legs).toBeUndefined();
    expect((prepared.updatedAt as Timestamp).toMillis()).toBe(1000);
    expect(prepared.controls.leg.override).toBe(12.3);
    expect(resolveEffectiveTrainingLoad({}, prepared)).toMatchObject({ score: null, reasons: ['source-updating'] });
    await source(uid, changed); // A prior attempt wrote sources, but failed before final metadata.
    const retry = await prepareTrainingLoadMetadata(uid, changed);
    await ref.update({ 'controls.leg.override': 15, revision: 3 }); // Edit after preparation must also survive.
    await retry();
    const result = (await ref.get()).data() as TrainingLoadMetadata;
    expect(result.legacyLegs).toBeUndefined();
    expect(result.controls.leg.override).toBe(15);
    expect(result.legs!.leg).toMatchObject({ activityId: null, identity: { type: ActivityTypes.Walking } });
    expect(Object.values(result.legs!).filter(leg => leg.activityId === 'leg')).toHaveLength(1);
    expect(resolveEffectiveTrainingLoad({}, result)).toMatchObject({ status: 'unavailable', reasons: ['activity-match-needs-review'] });
  });
  it('retains first-import dating across a failed source write and a concurrent zero override', async () => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    await db.doc(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions/past`).set({
      revision: 1, method: 'HR', included: true, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)) });
    const event = workout(); await prepareTrainingLoadMetadata(uid, event); await source(uid, event);
    await db.doc(metadataPath(uid)).update({ controls: { leg: { override: 0 } }, revision: 2 });
    const finish = await prepareTrainingLoadMetadata(uid, event); await source(uid, event); await finish();
    const result = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
    expect(result.legs!.leg.policy).toMatchObject({ revision: 1, method: 'HR' });
    expect(result.sourceFirstImport).toBeUndefined();
    expect(resolveEffectiveTrainingLoad({}, result).score).toBe(0);
  });

  it('accepts a first-import control created between the source and metadata writes', async () => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    await db.doc(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions/past`).set({
      revision: 1, method: 'MET', included: true, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)) });
    const event = workout(); const finish = await prepareTrainingLoadMetadata(uid, event);
    await source(uid, event);
    await db.doc(metadataPath(uid)).set({ version: 1, revision: 1, excluded: false, controls: { leg: { override: 0 } } });
    await finish();
    const result = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
    expect(result.legs!.leg.policy).toMatchObject({ revision: 1, method: 'MET' });
    expect(resolveEffectiveTrainingLoad({}, result)).toMatchObject({ score: 0, status: 'available' });
  });
  it('evaluates uncached JSON power inputs before saving source statistics', async () => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    const start = Date.UTC(2026, 0, 2);
    const event = EventImporterJSON.getEventFromJSON({ name: 'Ride', startDate: start, endDate: start + 3600000,
      activities: [{ startDate: start, endDate: start + 3600000, type: ActivityTypes.Cycling,
        creator: { name: 'Test' }, laps: [], intensityZones: [], streams: [],
        stats: { FTP: 200, 'Power Normalized': 200, Duration: 3600 } }] } as any);
    event.setID('workout'); event.getActivities()[0].setID('leg');
    // JSON imports do not run the stream/stat generator used by FIT importers.
    // Evaluating their power candidate also derives Power Intensity Factor.
    expect(event.getActivities()[0].getStat('Power Intensity Factor')).toBeUndefined();
    const finish = await prepareTrainingLoadMetadata(uid, event);
    await source(uid, event);
    await finish();
    expect((await db.doc(`users/${uid}/activities/leg`).get()).data()?.stats['Power Intensity Factor']).toBe(1);
    const result = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
    expect(result.legs!.leg.evaluations?.automatic).toMatchObject({ method: 'POWER', score: 99.2 });
    const docs = await attachEventTrainingLoads(uid, [(await db.doc(`users/${uid}/events/workout`).get())]);
    expect(attachedEffectiveTrainingLoad(docs[0].data()!)).toMatchObject({ score: 99.2, status: 'available' });
  });
  it('retains a legacy control with missing source evidence as an unmatched record for owner review', async () => {
    const uid = setup(); const event = workout(); await source(uid, event);
    const ref = db.doc(metadataPath(uid));
    await ref.set({ version: 1, revision: 1, excluded: false, controls: { missing: { override: 5 } } });
    const finish = await prepareTrainingLoadMetadata(uid, event); await source(uid, event); await finish();
    const result = (await ref.get()).data() as TrainingLoadMetadata;
    expect(result.controls.missing.override).toBe(5);
    expect(result.legs!.missing).toMatchObject({ activityId: null, identity: { startMs: null, type: 'Unknown' } });
    expect(resolveEffectiveTrainingLoad({}, result).status).toBe('unavailable');
  });
});
