import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { randomUUID } from 'node:crypto';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.unmock('firebase-admin');
vi.unmock('@sports-alliance/sports-lib');
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ActivityParsingOptions, ActivityTypes, ActivityUtilities, DataDistance, DataEnergy, EventImporterFIT, EventImporterJSON, type EventInterface } from '@sports-alliance/sports-lib';
import { prepareTrainingLoadMetadata } from './training-load-metadata';
import { completeTrainingLoadCacheWarmup, prepareTrainingLoadCacheWrite, readTrainingLoadSummaries, refreshTrainingLoadSummary, splitTrainingLoadBucket, summarizeTrainingLoad, trainingLoadCacheKey } from './training-load-cache';
import { attachEventTrainingLoads } from './training-load-reader';
import { attachedEffectiveTrainingLoad, resolveEffectiveTrainingLoad, type TrainingLoadMetadata } from '../../../shared/training-load-policy';

import { mergeRecordedEvents } from '../events/merge-recorded-events';
import { prepareMergedTrainingLoad, type MergeTrainingLoadSource } from '../events/merge-training-load';
import { sourceReferenceFingerprint } from '../reparse/non-activity-sources';
import { persistReparsedEvent, writeReparseStatus } from '../reparse/sports-lib-reparse.service';
import { EventWriter, type FirestoreAdapter } from '../shared/event-writer';
import { prepareImportedEventWrite, preserveImportedActivityEdits, preserveImportedEventEdits } from '../shared/import-preservation';
import { TrainingLoadSourceWrite } from './training-load-source-write';

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
// Contended real Firestore transactions can retry beyond the five-second unit-test budget.
describe.skipIf(!enabled)('Training load persistence in Firestore', { timeout: 30_000 }, () => {
  let db: admin.firestore.Firestore;
  const users: string[] = [];
  function setup() {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-walking-tss' });
      admin.firestore().settings({ ignoreUndefinedProperties: true });
    }
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
  async function importWorkout(uid: string, event: EventInterface) {
    await db.doc(`users/${uid}`).set({ test: true });
    const finish = await prepareTrainingLoadMetadata(uid, event);
    await source(uid, event);
    await finish();
    return finish;
  }
  const metadataPath = (uid: string) => `users/${uid}/events/workout/metaData/trainingLoad`;
  function reuploadWriter(uid: string) {
    const guard = new TrainingLoadSourceWrite(uid, event => prepareImportedEventWrite(uid, event));
    const setDoc = vi.fn(async (path: string[], data: unknown) => db.runTransaction(async transaction => {
      await guard.assertCurrent(db, transaction);
      const ref = db.doc(path.join('/')); const current = await transaction.get(ref);
      const preserve = path[2] === 'events' ? preserveImportedEventEdits : preserveImportedActivityEdits;
      transaction.set(ref, preserve(data as admin.firestore.DocumentData, current.data() ?? null));
    }));
    const writer = new EventWriter({
      prepareTrainingLoad: guard.prepareTrainingLoad,
      setDoc, createBlob: data => Buffer.from(data), generateID: () => randomUUID(),
    });
    return { writer, setDoc };
  }
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
  }
  it('reuploads a source-keyed activity without duplicating it or losing live edits and load overrides', async () => {
    const uid = setup(); await importWorkout(uid, workout('source-keyed-id'));
    const parent = db.doc(`users/${uid}/events/workout`);
    const child = db.doc(`users/${uid}/activities/source-keyed-id`);
    await parent.update({ name: 'Edited title', description: 'Edited description', tags: ['Saved tag'],
      notes: 'Saved notes', 'stats.Feeling': 5, 'stats.Rated Perceived Exertion': 8 });
    await child.update({ 'creator.name': 'Custom device', sourceActivityKey: 'saved-source-key' });
    await db.doc(metadataPath(uid)).update({ controls: { 'source-keyed-id': { override: 42 } } });
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = workout('legacy-index-id');
      const { writer } = reuploadWriter(uid);
      await writer.writeAllEventData(uid, parsed);
      const children = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
      expect(children.docs.map(doc => doc.id)).toEqual(['source-keyed-id']);
      expect((await child.get()).data()).toMatchObject({ creator: { name: 'Custom device' }, sourceActivityKey: 'saved-source-key' });
      expect((await parent.get()).data()).toMatchObject({ name: 'Edited title', description: 'Edited description', tags: ['Saved tag'],
        notes: 'Saved notes', stats: { Feeling: 5, 'Rated Perceived Exertion': 8 } });
      const metadata = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
      expect(metadata).toMatchObject({ sourceWritePending: false, controls: { 'source-keyed-id': { override: 42 } } });
      expect(resolveEffectiveTrainingLoad({}, metadata)).toMatchObject({ score: 42, status: 'available' });
    }
  });
  it.each(['ambiguous duplicates', 'changed leg set'])('keeps saved load available when a reupload rejects %s', async reason => {
    const uid = setup(); await importWorkout(uid, workout('saved-leg'));
    const metaRef = db.doc(metadataPath(uid));
    await metaRef.update({ controls: { 'saved-leg': { override: 42 } } });
    await refreshTrainingLoadSummary(uid, 'workout');
    await completeTrainingLoadCacheWarmup(uid);
    const parsed = workout('incoming-leg');
    const parent = db.doc(`users/${uid}/events/workout`);
    if (reason === 'ambiguous duplicates') {
      const saved = await db.doc(`users/${uid}/activities/saved-leg`).get();
      await db.doc(`users/${uid}/activities/duplicate-leg`).set(saved.data()!);
    } else {
      parsed.addActivity(workout('extra-leg', Date.UTC(2026, 0, 2, 1)).getFirstActivity());
    }
    const metadataBefore = await metaRef.get();
    const parentBefore = await parent.get();
    const activities = db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout');
    const childrenBefore = await activities.get();
    const cacheBefore = await readTrainingLoadSummaries(uid);
    expect(cacheBefore?.get('workout')?.load).toMatchObject({ score: 42, status: 'available' });
    const { writer, setDoc } = reuploadWriter(uid);

    await expect(writer.writeAllEventData(uid, parsed)).rejects.toThrow('Cannot safely match');

    const metadataAfter = await metaRef.get();
    expect(metadataAfter.data()).toEqual(metadataBefore.data());
    expect(metadataAfter.updateTime?.isEqual(metadataBefore.updateTime!)).toBe(true);
    expect(resolveEffectiveTrainingLoad(parentBefore.data()!, metadataAfter.data() as TrainingLoadMetadata))
      .toMatchObject({ score: 42, status: 'available' });
    expect(await readTrainingLoadSummaries(uid)).toEqual(cacheBefore);
    expect((await parent.get()).updateTime?.isEqual(parentBefore.updateTime!)).toBe(true);
    expect((await activities.get()).docs.map(doc => [doc.id, doc.data()]))
      .toEqual(childrenBefore.docs.map(doc => [doc.id, doc.data()]));
    expect(setDoc).not.toHaveBeenCalled();
    expect(parsed.getActivities().map(activity => activity.getID()))
      .toEqual(reason === 'ambiguous duplicates' ? ['incoming-leg'] : ['incoming-leg', 'extra-leg']);
  });
  it('advances the benchmark save guard before an ordinary workout has its first report', async () => {
    const { SPORTS_LIB_VERSION } = await import('../shared/sports-lib-version.node');
    const uid = setup();
    const ordinaryWorkout = () => {
      const event = workout();
      event.addActivity(workout('second-leg', Date.UTC(2026, 0, 2, 1)).getFirstActivity());
      return event;
    };
    await source(uid, ordinaryWorkout());
    const ref = db.doc(`users/${uid}/events/workout`);
    for (const revision of [1, 2]) {
      const legs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
      await persistReparsedEvent(uid, 'workout', ordinaryWorkout(), (await ref.get()).data()!, legs.docs, SPORTS_LIB_VERSION);
      const saved = (await ref.get()).data()!;
      expect(saved.benchmarkSourceRevision).toBe(revision);
      expect(saved).not.toHaveProperty('benchmarkResults');
      expect(saved).not.toHaveProperty('hasBenchmark');
    }
  });

  it('finalizes a real writer reparse when Firestore omits an unnamed source device', async () => {
    const { SPORTS_LIB_VERSION } = await import('../shared/sports-lib-version.node');
    const uid = setup(); await source(uid, workout('old'));
    const ref = db.doc(`users/${uid}/events/workout`);
    const oldLegs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    const unnamed = workout('unnamed');
    delete (unnamed.getFirstActivity().creator as { name?: string }).name;
    const parsed = mergeRecordedEvents([unnamed, workout('named', Date.UTC(2026, 0, 2, 1))], 'workout');
    expect(parsed.toJSON().stats?.['Device Names']).toEqual([undefined, 'Test']);

    // Exercise EventWriter and Firestore directly: a JSON roundtrip would turn undefined into null.
    const result = await persistReparsedEvent(uid, 'workout', parsed, (await ref.get()).data()!, oldLegs.docs, SPORTS_LIB_VERSION);
    expect(result.staleActivitiesDeleted).toBe(1);
    expect((await ref.get()).data()).toMatchObject({ stats: { 'Device Names': ['Test'] }, benchmarkSourceWritePending: false });
    expect((await ref.collection('metaData').doc('processing').get()).data()?.sportsLibVersion).toBe(SPORTS_LIB_VERSION);
    const metadata = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
    expect(metadata.sourceWritePending).toBe(false);
    expect(Object.values(metadata.legs!).map(leg => leg.activityId).sort())
      .toEqual(parsed.getActivities().map(activity => activity.getID()).sort());
    expect((await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get()).docs.map(doc => doc.id).sort())
      .toEqual(parsed.getActivities().map(activity => activity.getID()).sort());
    await completeTrainingLoadCacheWarmup(uid);
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.status).toBe('available');
  });

  it('preserves benchmark reports and remaps participants through repeated real writer reparses', async () => {
    const { DataDuration } = await import('@sports-alliance/sports-lib');
    const { SPORTS_LIB_VERSION } = await import('../shared/sports-lib-version.node');
    const uid = setup();
    const comparison = (suffix: string) => {
      const event = workout(`ref-${suffix}`);
      event.addActivity(workout(`test-${suffix}`, Date.UTC(2026, 0, 2, 1)).getFirstActivity());
      event.isMerge = true;
      (event as EventInterface & { mergeType: string }).mergeType = 'benchmark';
      event.getActivities().forEach((activity, index) => {
        activity.addStat(new DataDuration(3600));
        activity.addStat(new DataDistance(1000 + index * 1000));
      });
      return event;
    };
    await source(uid, comparison('old'));
    const ref = db.doc(`users/${uid}/events/workout`);
    await ref.update({ mergeType: 'benchmark', toolSource: 'tools/compare', comparisonTitle: 'Saved comparison',
      hasBenchmark: true, tags: ['firmware'], benchmarkResults: { 'ref-old_test-old': {
        referenceId: 'ref-old', testId: 'test-old', timestamp: new Date(0),
        metrics: { gnss: null, streamMetrics: {} },
      } } });
    const oldLegs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    await persistReparsedEvent(uid, 'workout', comparison('new'), (await ref.get()).data()!, oldLegs.docs, SPORTS_LIB_VERSION);
    const first = (await ref.get()).data()!;
    expect(first).toMatchObject({ comparisonTitle: 'Saved comparison', tags: ['firmware'], mergeType: 'benchmark', benchmarkSourceRevision: 1 });
    expect(first.benchmarkResults['ref-new_test-new']).toMatchObject({ referenceId: 'ref-new', testId: 'test-new',
      requiresRegeneration: true, activityLinksResolved: true, metrics: { gnss: null } });
    const newLegs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    expect(newLegs.docs.map(doc => doc.id).sort()).toEqual(['ref-new', 'test-new']);
    await persistReparsedEvent(uid, 'workout', comparison('new'), first, newLegs.docs, SPORTS_LIB_VERSION);
    const second = (await ref.get()).data()!;
    expect(second.benchmarkResults).toEqual(first.benchmarkResults);
    expect(second.benchmarkSourceRevision).toBe(2);
  });

  it.each(['activity-write', 'stale-cleanup'])(
    'holds benchmark generation until the complete source is stable: %s', async phase => {
      const { SPORTS_LIB_VERSION } = await import('../shared/sports-lib-version.node');
      const uid = setup(); await source(uid, workout('old'));
      const ref = db.doc(`users/${uid}/events/workout`);
      const oldLegs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
      const parsed = workout('new-first');
      parsed.addActivity(workout('new-second', Date.UTC(2026, 0, 2, 1)).getFirstActivity());
      const paused = gate(); const resume = gate();
      const write = EventWriter.prototype.writeAllEventData;
      const spy = vi.spyOn(EventWriter.prototype, 'writeAllEventData').mockImplementationOnce(async function (...args) {
        const adapter = (this as unknown as { adapter: FirestoreAdapter }).adapter;
        const setDoc = adapter.setDoc;
        adapter.setDoc = async (path, data) => {
          if (phase === 'activity-write' && path[2] === 'activities' && path[3] === 'new-second') await resume.promise;
          await setDoc(path, data);
          if (phase === 'activity-write' && path[2] === 'events') paused.release();
        };
        const result = await write.apply(this, args);
        if (phase === 'stale-cleanup') { paused.release(); await resume.promise; }
        return result;
      });
      const rewriting = persistReparsedEvent(uid, 'workout', parsed, (await ref.get()).data()!, oldLegs.docs, SPORTS_LIB_VERSION);
      const outcome = rewriting.then(value => ({ value }), error => ({ error }));
      try {
        await Promise.race([paused.promise, outcome.then(result => { throw new Error(`Reparse finished without pausing: ${JSON.stringify(result)}`); })]);
        const partial = (await ref.get()).data()!;
        expect(partial).toMatchObject({ benchmarkSourceRevision: 0, benchmarkSourceWritePending: true });
        expect((await db.doc(`users/${uid}/activities/old`).get()).exists).toBe(true);
        expect((await db.doc(`users/${uid}/activities/new-second`).get()).exists).toBe(phase === 'stale-cleanup');
        resume.release();
        await rewriting;
        const complete = (await ref.get()).data()!;
        expect(complete).toMatchObject({ benchmarkSourceRevision: 1, benchmarkSourceWritePending: false });
        // A preview hydrated at either partial stage must fail the completed revision check too.
        expect(complete.benchmarkSourceRevision).not.toBe(partial.benchmarkSourceRevision);
        const current = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
        expect(current.docs.map(doc => doc.id).sort()).toEqual(['new-first', 'new-second']);
      } finally { resume.release(); await outcome; spy.mockRestore(); }
    });

  it('keeps failed source writes blocked until a successful reparse retry completes', async () => {
    const { SPORTS_LIB_VERSION } = await import('../shared/sports-lib-version.node');
    const uid = setup(); await source(uid, workout('old'));
    const ref = db.doc(`users/${uid}/events/workout`);
    const oldLegs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    const write = EventWriter.prototype.writeAllEventData;
    const spy = vi.spyOn(EventWriter.prototype, 'writeAllEventData').mockImplementationOnce(async function (...args) {
      await write.apply(this, args);
      throw new Error('Interrupted before stale cleanup');
    });
    try {
      await expect(persistReparsedEvent(uid, 'workout', workout('new'), (await ref.get()).data()!, oldLegs.docs, SPORTS_LIB_VERSION))
        .rejects.toThrow('Interrupted before stale cleanup');
      expect((await ref.get()).data()).toMatchObject({ benchmarkSourceRevision: 0, benchmarkSourceWritePending: true });
    } finally { spy.mockRestore(); }
    const partialLegs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    await persistReparsedEvent(uid, 'workout', workout('new'), (await ref.get()).data()!, partialLegs.docs, SPORTS_LIB_VERSION);
    expect((await ref.get()).data()).toMatchObject({ benchmarkSourceRevision: 1, benchmarkSourceWritePending: false });
    expect((await db.doc(`users/${uid}/activities/old`).get()).exists).toBe(false);
  });

  it('keeps processing eligible for retry when the atomic source completion fails', async () => {
    const { SPORTS_LIB_VERSION } = await import('../shared/sports-lib-version.node');
    const uid = setup(); await source(uid, workout());
    const ref = db.doc(`users/${uid}/events/workout`);
    const legs = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    const runTransaction = db.runTransaction.bind(db);
    const spy = vi.spyOn(db, 'runTransaction').mockImplementation(update => runTransaction(async transaction => {
      const set = transaction.set.bind(transaction);
      const setSpy = vi.spyOn(transaction, 'set').mockImplementation((target, data, options) => {
        if (target.path === ref.path && data.benchmarkSourceWritePending === false) {
          throw new Error('Source completion interrupted');
        }
        return set(target, data, options!);
      });
      try { return await update(transaction); } finally { setSpy.mockRestore(); }
    }));
    try {
      await expect(persistReparsedEvent(uid, 'workout', workout(), (await ref.get()).data()!, legs.docs, SPORTS_LIB_VERSION))
        .rejects.toThrow('Source completion interrupted');
      expect((await ref.get()).data()).toMatchObject({ benchmarkSourceRevision: 0, benchmarkSourceWritePending: true });
      expect((await ref.collection('metaData').doc('processing').get()).exists).toBe(false);
    } finally { spy.mockRestore(); }
    await persistReparsedEvent(uid, 'workout', workout(), (await ref.get()).data()!, legs.docs, SPORTS_LIB_VERSION);
    expect((await ref.get()).data()).toMatchObject({ benchmarkSourceRevision: 1, benchmarkSourceWritePending: false });
    expect((await ref.collection('metaData').doc('processing').get()).data()?.sportsLibVersion).toBe(SPORTS_LIB_VERSION);
  });

  it.each(['unchanged', 'replaced', 'event-deleted', 'user-deleted'])(
    'guards non-activity reparse classification in a real transaction: %s', async lifecycle => {
      const uid = setup(); await source(uid, workout());
      const eventRef = db.doc(`users/${uid}/events/workout`);
      const statusRef = eventRef.collection('metaData').doc('reparseStatus');
      const originalFiles = [{ path: `users/${uid}/events/workout/original.fit`, bucket: 'test-bucket' }];
      await eventRef.update(sanitizeEventFirestoreWritePayload({ originalFiles }));
      if (lifecycle === 'replaced') await eventRef.update(sanitizeEventFirestoreWritePayload({ originalFiles: [{ path: 'replacement.fit' }] }));
      if (lifecycle === 'event-deleted') await db.recursiveDelete(eventRef);
      if (lifecycle === 'user-deleted') await db.doc(`userDeletionTombstones/${uid}`).set({ deleting: true });
      const operation = writeReparseStatus(uid, 'workout', { status: 'skipped', reason: 'MONITORING_SOURCE',
        targetSportsLibVersion: '22.0.0', checkedAt: Timestamp.now(), nonActivitySources: {
          schemaVersion: 1, sourceFingerprint: sourceReferenceFingerprint(originalFiles), sources: [{
            path: originalFiles[0].path, bucket: 'test-bucket', generation: '1', md5: 'checksum', sha256: 'hash', kind: 'monitoring',
          }],
        },
      });
      if (lifecycle === 'unchanged') {
        await operation;
        expect((await statusRef.get()).data()).toMatchObject({ status: 'skipped', reason: 'MONITORING_SOURCE' });
      } else {
        await expect(operation).rejects.toThrow();
        expect((await statusRef.get()).exists).toBe(false);
      }
      expect((await db.doc(`users/${uid}/activities/leg`).get()).exists).toBe(true);
    });

  it('does not recreate event metadata through a subsequent failure status write', async () => {
    const uid = setup(); await source(uid, workout());
    const ref = db.doc(`users/${uid}/events/workout`);
    await db.recursiveDelete(ref);
    await expect(writeReparseStatus(uid, 'workout', { status: 'failed', reason: 'REPARSE_FAILED',
      targetSportsLibVersion: '22.0.0', checkedAt: Timestamp.now(),
    })).rejects.toMatchObject({ name: 'EventWriteSkippedForDeletedEventError' });
    expect((await ref.collection('metaData').get()).empty).toBe(true);
  });

  it.each(['events', 'activities'])('blocks a superseded reparse from overwriting newer %s documents', async collection => {
    const uid = setup(); await source(uid, workout());
    const paused = gate(); const resume = gate();
    const write = EventWriter.prototype.writeAllEventData;
    const spy = vi.spyOn(EventWriter.prototype, 'writeAllEventData').mockImplementationOnce(async function (...args) {
      const adapter = (this as unknown as { adapter: FirestoreAdapter }).adapter;
      const setDoc = adapter.setDoc;
      adapter.setDoc = async (path, data) => {
        if (path[2] === collection) { paused.release(); await resume.promise; }
        return setDoc(path, data);
      };
      return write.apply(this, args);
    });
    const old = persistReparsedEvent(uid, 'workout', workout(), {}, [], '22.0.0');
    // Attach rejection handling before releasing the suspended old source transaction.
    const result = old.then(() => null, error => error);
    try {
      await Promise.race([paused.promise, result.then(error => { throw error ?? new Error('Old write completed without pausing'); })]);
      const newer = workout(); newer.name = 'Newer source';
      newer.addStat(new DataDistance(123));
      newer.getFirstActivity().addStat(new DataEnergy(420));
      const finish = await prepareTrainingLoadMetadata(uid, newer);
      await source(uid, newer); await finish();
      const ref = db.doc(`users/${uid}/${collection}/${collection === 'events' ? 'workout' : 'leg'}`);
      const before = await ref.get();
      resume.release();
      expect((await result)?.message).toMatch(/superseded/);
      expect((await ref.get()).updateTime?.isEqual(before.updateTime!)).toBe(true);
      expect((await db.doc(metadataPath(uid)).get()).data()?.sourceWritePending).toBe(false);
    } finally { resume.release(); await result; spy.mockRestore(); }
  });
  it('blocks stale reparse cleanup from deleting a leg restored by a newer import', async () => {
    const uid = setup(); await source(uid, workout());
    const paused = gate(); const resume = gate();
    const write = EventWriter.prototype.writeAllEventData;
    const spy = vi.spyOn(EventWriter.prototype, 'writeAllEventData').mockImplementationOnce(async function (...args) {
      const result = await write.apply(this, args);
      paused.release(); await resume.promise;
      return result;
    });
    const old = persistReparsedEvent(uid, 'workout', workout(), {}, [{ id: 'restored', data: () => ({}) }], '21.6.0');
    const result = old.then(() => null, error => error);
    try {
      await Promise.race([paused.promise, result.then(error => { throw error ?? new Error('Old write completed without pausing'); })]);
      const newer = workout();
      newer.addActivity(workout('restored', Date.UTC(2026, 0, 2, 1)).getFirstActivity());
      const finish = await prepareTrainingLoadMetadata(uid, newer);
      await source(uid, newer); await finish();
      const metadata = db.doc(metadataPath(uid));
      const saved = (await metadata.get()).data()!;
      await metadata.update({ controls: { restored: { override: 0, included: false } }, revision: saved.revision + 1 });
      resume.release();
      expect((await result)?.message).toMatch(/superseded/);
      expect((await db.doc(`users/${uid}/activities/restored`).get()).exists).toBe(true);
      expect((await metadata.get()).data()?.controls).toEqual({ restored: { override: 0, included: false } });
      expect((await db.doc(`users/${uid}/events/workout/metaData/processing`).get()).exists).toBe(false);
    } finally { resume.release(); await result; spy.mockRestore(); }
  });
  it('retries an interrupted real multisport reparse with new IDs without losing zero overrides, exclusions or saved policies', async () => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    const multi = (suffix: string) => {
      const event = workout(`first-${suffix}`);
      event.addActivity(workout(`second-${suffix}`, Date.UTC(2026, 0, 2, 1)).getFirstActivity());
      return event;
    };
    const initial = multi('initial');
    const finish = await prepareTrainingLoadMetadata(uid, initial);
    await source(uid, initial); await finish();
    const ref = db.doc(metadataPath(uid));
    await ref.update({ controls: { 'first-initial': { override: 0 }, 'second-initial': { included: false } } });
    const before = (await ref.get()).data() as TrainingLoadMetadata;
    // The retry may already be parsing when the interrupted attempt writes its new child IDs.
    const earlierSnapshot = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    const write = EventWriter.prototype.writeAllEventData;
    const spy = vi.spyOn(EventWriter.prototype, 'writeAllEventData').mockImplementationOnce(async function (...args) {
      const adapter = (this as unknown as { adapter: FirestoreAdapter }).adapter;
      const setDoc = adapter.setDoc;
      adapter.setDoc = (path, data) => path[2] === 'events'
        ? Promise.reject(new Error('interrupted parent write')) : setDoc(path, data);
      return write.apply(this, args);
    });
    try {
      await expect(persistReparsedEvent(uid, 'workout', multi('partial'), {}, [], '22.0.0')).rejects.toThrow('interrupted parent write');
    } finally { spy.mockRestore(); }
    expect((await ref.get()).data()?.sourceWritePending).toBe(true);
    const existing = await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get();
    expect(existing.docs).toHaveLength(4);
    const retry = multi('retry');
    await persistReparsedEvent(uid, 'workout', retry, {}, earlierSnapshot.docs, '22.0.0');
    const after = (await ref.get()).data() as TrainingLoadMetadata;
    expect(after.controls).toEqual(before.controls);
    expect(after.legs?.['first-initial']).toMatchObject({ activityId: 'first-retry', policy: before.legs!['first-initial'].policy });
    expect(after.legs?.['second-initial']).toMatchObject({ activityId: 'second-retry', policy: before.legs!['second-initial'].policy });
    expect(resolveEffectiveTrainingLoad(retry, after)).toMatchObject({ score: 0, status: 'available' });
    expect((await db.collection(`users/${uid}/activities`).where('eventID', '==', 'workout').get()).docs.map(doc => doc.id).sort())
      .toEqual(['first-retry', 'second-retry']);
  });
  afterAll(async () => {
    if (!db) return;
    for (const uid of users) {
      await db.recursiveDelete(db.doc(`users/${uid}`));
      await db.doc(`userDeletionTombstones/${uid}`).delete();
    }
    await db.terminate();
  });
  async function saveMergeEvent(uid: string, event: EventInterface) {
    const eventId = event.getID()!;
    await db.doc(`users/${uid}/events/${eventId}`).set(JSON.parse(JSON.stringify(sanitizeEventFirestoreWritePayload(event.toJSON()))));
    for (const activity of event.getActivities()) await db.doc(`users/${uid}/activities/${activity.getID()}`).set({
      ...JSON.parse(JSON.stringify(sanitizeActivityFirestoreWritePayload(activity.toJSON()))), eventID: eventId });
  }
  async function mergeFixtures(uid: string) {
    await db.doc(`users/${uid}`).set({ test: true });
    const events: EventInterface[] = [];
    const sources: MergeTrainingLoadSource[] = [];
    for (const id of ['a', 'b']) {
      const event = workout(`${id}-leg`).setID(id);
      const finish = await prepareTrainingLoadMetadata(uid, event);
      await saveMergeEvent(uid, event); await finish(); events.push(event);
      sources.push({ eventId: id, parent: (await db.doc(`users/${uid}/events/${id}`).get()).data()!,
        activities: [{ id: `${id}-leg`, data: (await db.doc(`users/${uid}/activities/${id}-leg`).get()).data()! }] });
    }
    return { events, sources };
  }
  it('merges saved load snapshots without reparsing, retains source exclusions, and finalizes concurrent controls atomically', async () => {
    const uid = setup(); const { events, sources } = await mergeFixtures(uid);
    const firstMetadata = db.doc(`users/${uid}/events/a/metaData/trainingLoad`);
    await firstMetadata.update({ excluded: true, controls: { 'a-leg': { override: 777 } } });
    const originalSource = (await firstMetadata.get()).data();
    const merged = mergeRecordedEvents(events, 'combined');
    const finish = await prepareMergedTrainingLoad(uid, merged, sources);
    const mergedRef = db.doc(`users/${uid}/events/combined/metaData/trainingLoad`);
    expect((await mergedRef.get()).data()?.sourceWritePending).toBe(true);
    await saveMergeEvent(uid, merged);
    const secondId = merged.getActivities()[1].getID()!;
    const pending = (await mergedRef.get()).data()!;
    await mergedRef.update({ controls: { ...pending.controls, [secondId]: { override: 0 } }, revision: pending.revision + 1 });
    await finish();
    const saved = (await mergedRef.get()).data() as TrainingLoadMetadata;
    expect(resolveEffectiveTrainingLoad(merged, saved)).toMatchObject({ score: 0, status: 'available' });
    expect(saved.legs![merged.getFirstActivity().getID()!].evaluations?.automatic.score).toBe(9);
    expect((await firstMetadata.get()).data()).toEqual(originalSource);
    await completeTrainingLoadCacheWarmup(uid);
    expect((await readTrainingLoadSummaries(uid))?.get('combined')?.load).toMatchObject({ score: 0, status: 'available' });
    const timestamp = (await mergedRef.get()).updateTime;
    await finish();
    expect((await mergedRef.get()).updateTime?.isEqual(timestamp!)).toBe(true);
  });
  it('rejects stale merge sources and deletion during pending merge completion', async () => {
    const uid = setup(); const { events, sources } = await mergeFixtures(uid);
    const merged = mergeRecordedEvents(events, 'combined');
    const original = sources[0].activities[0].data;
    await db.doc(`users/${uid}/activities/a-leg`).update({ 'stats.Energy': 999 });
    await expect(prepareMergedTrainingLoad(uid, merged, sources)).rejects.toThrow(/changed|review/);
    const mergedRef = db.doc(`users/${uid}/events/combined/metaData/trainingLoad`);
    expect((await mergedRef.get()).exists).toBe(false);
    await db.doc(`users/${uid}/activities/a-leg`).set(original);
    const finish = await prepareMergedTrainingLoad(uid, merged, sources);
    await saveMergeEvent(uid, merged);
    await db.doc(`userDeletionTombstones/${uid}`).set({ startedAt: Timestamp.now() });
    await expect(finish()).rejects.toThrow(/deletion/);
    expect((await mergedRef.get()).data()?.sourceWritePending).toBe(true);
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
    await finish();
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
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
    const before = (await db.doc(metadataPath(uid)).get()).data();
    const evaluate = vi.spyOn(ActivityUtilities, 'getTrainingStressScoreEvaluations').mockImplementationOnce(() => { throw new Error('invalid input'); });
    try { await expect(prepareTrainingLoadMetadata(uid, event)).rejects.toThrow('invalid input'); }
    finally { evaluate.mockRestore(); }
    expect((await db.doc(metadataPath(uid)).get()).data()).toEqual(before);
  });

  it.each(['pending', 'completed'])('rejects an older finalizer after a newer multisport import is %s', async phase => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    const original = workout();
    const finishOlder = await prepareTrainingLoadMetadata(uid, original);
    await source(uid, original);
    // A later parser recognizes an additional zero-load leg without changing
    // the independently recorded parent summary or the original leg.
    const revised = workout();
    const extra = EventImporterJSON.getEventFromJSON({ name: 'Transition', startDate: +revised.endDate, endDate: +revised.endDate,
      activities: [{ startDate: +revised.endDate, endDate: +revised.endDate, type: ActivityTypes.Cycling,
        creator: { name: 'Test' }, laps: [], intensityZones: [], streams: [],
        stats: { Duration: 0, 'Training Stress Score': 0 } }] } as any).getFirstActivity().setID('transition');
    revised.addActivity(extra);
    const finishNewer = await prepareTrainingLoadMetadata(uid, revised);
    await source(uid, revised);
    if (phase === 'completed') await finishNewer();
    const ref = db.doc(metadataPath(uid));
    const before = (await ref.get()).data();
    await expect(finishOlder()).rejects.toThrow(/superseded|source changed/);
    expect((await ref.get()).data()).toEqual(before);
    if (phase === 'pending') await finishNewer();
    const saved = (await ref.get()).data() as TrainingLoadMetadata;
    expect(Object.values(saved.legs!).map(leg => leg.activityId).sort()).toEqual(['leg', 'transition']);
    expect(resolveEffectiveTrainingLoad({}, saved)).toMatchObject({ score: 9, status: 'available' });
    await finishNewer();
    expect((await ref.get()).data()).toEqual(saved);
  });

  it.each(['reservation', 'metadata'])('rejects finalization when the prepared %s is missing', async missing => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    const event = workout(); const finish = await prepareTrainingLoadMetadata(uid, event);
    await source(uid, event);
    const ref = db.doc(metadataPath(uid));
    const bucket = db.doc(`users/${uid}/trainingLoadCache/b_${trainingLoadCacheKey('workout')[0]}`);
    const cachedTime = (await bucket.get()).updateTime!;
    if (missing === 'reservation') await ref.update({ sourceWriteId: admin.firestore.FieldValue.delete() });
    else await ref.delete();
    const before = (await ref.get()).data();
    await expect(finish()).rejects.toThrow('superseded');
    expect((await ref.get()).data()).toEqual(before);
    expect((await bucket.get()).updateTime?.isEqual(cachedTime)).toBe(true);
  });

  it('preserves calculated load and cache writes when workout feedback is added, edited or removed', async () => {
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
    await completeTrainingLoadCacheWarmup(uid);
    const parent = db.doc(`users/${uid}/events/workout`);
    const metadata = db.doc(metadataPath(uid)); const originalMetadata = (await metadata.get()).data();
    const bucket = db.doc(`users/${uid}/trainingLoadCache/b_${trainingLoadCacheKey('workout')[0]}`);
    const cachedTime = (await bucket.get()).updateTime!;
    for (const feedback of [
      { 'stats.Feeling': 3, 'stats.Rated Perceived Exertion': 1 },
      { 'stats.Feeling': 5, 'stats.Rated Perceived Exertion': 8 },
      { 'stats.Feeling': admin.firestore.FieldValue.delete(), 'stats.Rated Perceived Exertion': admin.firestore.FieldValue.delete() },
    ]) {
      await parent.update(feedback);
      const [projection] = await attachEventTrainingLoads(uid, [await parent.get()]);
      expect(attachedEffectiveTrainingLoad(projection.data()!)).toMatchObject({ score: 9, status: 'available' });
      await refreshTrainingLoadSummary(uid, 'workout');
      expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 9, status: 'available' });
      expect((await bucket.get()).updateTime?.isEqual(cachedTime)).toBe(true);
      expect((await metadata.get()).data()).toEqual(originalMetadata);
    }
  });

  it('invalidates and caches a control edit made during an otherwise unchanged reimport', async () => {
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
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
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
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
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
    const parent = db.doc(`users/${uid}/events/workout`); const metadata = db.doc(metadataPath(uid));
    const revision = (await metadata.get()).data()!.revision;
    await attachEventTrainingLoads(uid, [await parent.get()]);
    await metadata.update({ controls: { leg: { override: 0 } }, revision: revision + 1 });
    await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 0, status: 'available' });
    await metadata.update({ excluded: true, revision: revision + 2 });
    await Promise.all([refreshTrainingLoadSummary(uid, 'workout'), refreshTrainingLoadSummary(uid, 'workout')]);
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.status).toBe('excluded');
    await metadata.update({ excluded: false, controls: {}, revision: revision + 3 }); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.score).toBe(9);
    await parent.delete(); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.has('workout')).toBe(false);
    expect((await db.collection(`users/${uid}/trainingLoadCache`).where('leaf', '==', true).get()).empty).toBe(true);
    await importWorkout(uid, event);
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

  it.each(['changed', 'deleted', 'moved'])('rejects a cached parent total when a parsed leg is %s', async mutation => {
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
    await completeTrainingLoadCacheWarmup(uid);
    const leg = db.doc(`users/${uid}/activities/leg`);
    if (mutation === 'changed') await leg.update({ 'stats.Energy': 999 });
    else if (mutation === 'deleted') await leg.delete();
    else await leg.update({ eventID: 'another-workout' });
    await refreshTrainingLoadSummary(uid, 'workout');
    const parent = db.doc(`users/${uid}/events/workout`);
    const [projection] = await attachEventTrainingLoads(uid, [await parent.get()]);
    expect(attachedEffectiveTrainingLoad(projection.data()!)).toMatchObject({ score: null, reasons: ['source-updating'] });
    // A delayed owner edit must not restore a score from stale candidates.
    await db.doc(metadataPath(uid)).update({ controls: { leg: { override: 0 } } });
    await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.score).toBeNull();
    await db.doc(metadataPath(uid)).update({ excluded: true }); await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load.status).toBe('excluded');
    await db.doc(metadataPath(uid)).update({ excluded: false });
    const finish = await prepareTrainingLoadMetadata(uid, event); await source(uid, event); await finish();
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 0, status: 'available' });
  });

  it('splits full buckets atomically under concurrent writes and reads 1,001 summaries in 17 billed document reads', async () => {
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
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
    const uid = setup(); const event = workout(); await db.doc(`users/${uid}`).set({ test: true });
    const revisions = db.collection(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions`);
    await revisions.doc('past').set({ revision: 1, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)), method: 'HR', included: true });
    await revisions.doc('future').set({ revision: 2, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 3)), method: 'MET', included: false });
    const finish = await importWorkout(uid, event);
    const ref = db.doc(metadataPath(uid));
    const first = (await ref.get()).data() as TrainingLoadMetadata;
    expect(first.legs!.leg).toMatchObject({ policy: { revision: 1, method: 'HR', included: true },
      evaluations: { automatic: { score: 9, method: 'MET' }, hr: { score: 9, reasons: ['missing-hr-calibration', 'missing-power-inputs'] } } });
    await finish();
    expect((await ref.get()).data()).toEqual(first);
    await ref.update({ controls: { leg: { override: 0 } }, revision: first.revision + 1 });
    const changed = workout('new'); await importWorkout(uid, changed);
    expect((await ref.get()).data()).toMatchObject({ revision: first.revision + 3, controls: { leg: { override: 0 } },
      legs: { leg: { activityId: 'new', policy: { revision: 1 } } } });
    // An obsolete source leg still awaits cleanup; it is not part of the new modeled leg set.
    await db.doc(`users/${uid}/activities/leg`).update({ 'stats.Energy': 999 });
    await refreshTrainingLoadSummary(uid, 'workout');
    const docs = await attachEventTrainingLoads(uid, [(await db.doc(`users/${uid}/events/workout`).get())]);
    expect(attachedEffectiveTrainingLoad(docs[0].data()!)).toMatchObject({ score: 0, status: 'available' });
  });
  it('preserves edits committed after the parser starts and blocks deleted owners and mismatched source data', async () => {
    const uid = setup(); const event = workout(); await importWorkout(uid, event);
    const finish = await prepareTrainingLoadMetadata(uid, event);
    await source(uid, event);
    const ref = db.doc(metadataPath(uid));
    const before = (await ref.get()).data()!;
    await ref.update({ excluded: true, revision: before.revision + 1 });
    await finish();
    expect((await ref.get()).data()?.excluded).toBe(true);
    await db.doc(`users/${uid}/activities/leg`).update({ 'stats.Energy': 999 });
    await expect(finish()).rejects.toThrow('source changed');
    await source(uid, event);
    await db.doc(`userDeletionTombstones/${uid}`).set({ deleting: true });
    await expect(finish()).rejects.toThrow('account deletion');
  });
  it.each([
    [ActivityTypes.Cycling, 2, 0, 164, 80],
    [ActivityTypes.Cycling, 2, 0, 165, 100],
    [ActivityTypes.Cycling, 2, 0, 166, 100],
    [ActivityTypes.Walking, 11, 0, 100, 40],
    [ActivityTypes.Hiking, 17, 0, 100, 40],
    [ActivityTypes.Swimming, 5, 17, 100, 40],
    [ActivityTypes.OpenWaterSwimming, 5, 18, 100, 40],
    [ActivityTypes.StrengthTraining, 10, 20, 100, 40],
  ] as const)('persists published FIT threshold HR for %s at %s/%s/%s with %s TSS across retry and concurrent override',
    async (type, sport, subSport, hr, score) => {
      const uid = setup(); const event = workout(); event.getFirstActivity().type = type;
      await importWorkout(uid, event);
      const ref = db.doc(metadataPath(uid));
      const before = (await ref.get()).data() as TrainingLoadMetadata;
      // Use the public encoder and importer, not fabricated evaluation metadata or athlete overrides.
      const field = (number: number, value: number, baseType = FitBaseType.Uint8) => ({ number, value, baseType,
        size: baseType === FitBaseType.Uint32 ? 4 : baseType === FitBaseType.Uint16 ? 2 : 1 });
      const encoder = new FitEncoder();
      const start = FitEncoder.toFitTimestamp(new Date(Date.UTC(2026, 0, 2)));
      encoder.writeMessage(0, [field(0, 4, FitBaseType.Enum), field(1, 1, FitBaseType.Uint16),
        field(4, start, FitBaseType.Uint32)]);
      encoder.writeMessage(3, [field(4, 700, FitBaseType.Uint16)], 4);
      for (let second = 0; second <= 3600; second += 60)
        encoder.writeMessage(20, [field(253, start + second, FitBaseType.Uint32), field(3, hr)], 1);
      encoder.writeMessage(18, [field(254, 0, FitBaseType.Uint16), field(253, start + 3600, FitBaseType.Uint32),
        field(2, start, FitBaseType.Uint32), field(5, sport, FitBaseType.Enum), field(6, subSport, FitBaseType.Enum),
        field(7, 3600000, FitBaseType.Uint32), field(8, 3600000, FitBaseType.Uint32),
        field(11, 210, FitBaseType.Uint16)], 2);
      encoder.writeMessage(216, [field(0, 18, FitBaseType.Uint16), field(1, 0, FitBaseType.Uint16),
        field(11, 0), field(12, 0), field(13, 165)], 3);
      const bytes = encoder.close();
      const changed = await EventImporterFIT.getFromArrayBuffer(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      changed.setID('workout'); changed.getFirstActivity().setID('new-leg');
      expect(changed.getFirstActivity().type).toBe(type);
      expect(JSON.stringify(changed.toJSON())).not.toMatch(/hrAlgorithm|threshold-hr-fallback/);
      await prepareTrainingLoadMetadata(uid, changed);
      await source(uid, changed); // Simulate an interrupted finalization.
      const finish = await prepareTrainingLoadMetadata(uid, changed);
      await ref.update({ controls: { leg: { override: 0 } }, revision: before.revision + 2 });
      await finish(); await finish();
      const saved = (await ref.get()).data() as TrainingLoadMetadata;
      expect(saved.legs!.leg).toMatchObject({ activityId: 'new-leg', policy: before.legs!.leg.policy,
        evaluations: { automatic: { method: 'HR', score, estimated: true, hrAlgorithm: 'THRESHOLD',
          reasons: expect.arrayContaining(['threshold-hr-fallback']) }, met: { method: 'MET', score: 9 } } });
      expect(saved.controls).toEqual({ leg: { override: 0 } });
      expect(resolveEffectiveTrainingLoad({}, saved, [], 'new-leg')).toMatchObject({ score: 0, method: 'OVERRIDE' });
      const restored = JSON.parse(JSON.stringify({ ...saved, controls: {} }));
      expect(resolveEffectiveTrainingLoad({}, restored, [], 'new-leg'))
        .toMatchObject({ score, hrAlgorithm: 'THRESHOLD', estimated: true });
    });
  it('serializes concurrent owner edits and source reparses without losing the override', async () => {
    const uid = setup(); const original = workout(); await importWorkout(uid, original);
    const ref = db.doc(metadataPath(uid));
    const before = (await ref.get()).data()!;
    const changed = workout('new-leg');
    const finish = await prepareTrainingLoadMetadata(uid, changed); await source(uid, changed);
    await Promise.all([
      finish(),
      db.runTransaction(async transaction => {
        const current = (await transaction.get(ref)).data()!;
        transaction.update(ref, { controls: { leg: { override: 12.3 } }, revision: current.revision + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }),
    ]);
    expect((await ref.get()).data()).toMatchObject({ revision: before.revision + 3, controls: { leg: { override: 12.3 } },
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
    const pending = (await ref.get()).data()!;
    await ref.update({ 'controls.leg.override': 15, revision: pending.revision + 1 }); // Edit after preparation must also survive.
    await retry();
    const result = (await ref.get()).data() as TrainingLoadMetadata;
    expect(result.legacyLegs).toBeUndefined();
    expect(result.controls.leg.override).toBe(15);
    expect(result.legs!.leg).toMatchObject({ activityId: null, identity: { type: ActivityTypes.Walking } });
    expect(Object.values(result.legs!).filter(leg => leg.activityId === 'leg')).toHaveLength(1);
    expect(resolveEffectiveTrainingLoad({}, result)).toMatchObject({ status: 'unavailable', reasons: ['activity-match-needs-review'] });
  });
  it.each([4000, 2000])('uses uncontrolled legacy legs to prevent an override moving to a surviving similar leg (controlled distance %s)', async controlledDistance => {
    const uid = setup();
    const original = workout('controlled');
    original.getFirstActivity().addStat(new DataDistance(controlledDistance));
    const other = workout('other').getFirstActivity();
    other.addStat(new DataDistance(2000)); original.addActivity(other);
    await source(uid, original);
    const ref = db.doc(metadataPath(uid));
    await ref.set({ version: 1, revision: 1, excluded: false, controls: { controlled: { override: 0 } } });
    await db.doc(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions/past`).set({
      revision: 7, method: 'HR', included: true, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)) });
    const changed = workout('remaining'); changed.getFirstActivity().addStat(new DataDistance(2000));
    const finish = await prepareTrainingLoadMetadata(uid, changed);
    await source(uid, changed); await finish();
    const saved = (await ref.get()).data() as TrainingLoadMetadata;
    expect(saved.legs!.controlled.activityId).toBeNull();
    expect(saved.controls).toEqual({ controlled: { override: 0 } });
    expect(Object.values(saved.legs!).filter(leg => !leg.activityId)).toHaveLength(1);
    expect(Object.values(saved.legs!).find(leg => leg.activityId === 'remaining')?.policy)
      .toMatchObject({ revision: 7, method: 'HR' });
    expect(resolveEffectiveTrainingLoad({}, saved)).toMatchObject({ score: null, reasons: ['activity-match-needs-review'] });
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

  it.each([false, true])('preserves first-import controls through retries without trusting reused IDs (changed identity: %s)', async changedIdentity => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    await db.doc(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions/past`).set({
      revision: 4, method: 'MET', included: true, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)) });
    const original = workout();
    original.addActivity(workout('second', original.endDate.getTime()).getFirstActivity());
    await prepareTrainingLoadMetadata(uid, original); await source(uid, original);
    const ref = db.doc(metadataPath(uid));
    await ref.update({ controls: { leg: { override: 0 }, second: { included: false } }, revision: 2 });
    const retry = workout(changedIdentity ? 'leg' : 'renamed');
    if (changedIdentity) retry.getFirstActivity().type = ActivityTypes.Cycling;
    retry.addActivity(workout('second-renamed', original.endDate.getTime()).getFirstActivity());
    // A second interruption must not replace the first attempt's frozen identity.
    await prepareTrainingLoadMetadata(uid, retry); await source(uid, retry);
    const finish = await prepareTrainingLoadMetadata(uid, retry); await source(uid, retry); await finish();
    const saved = (await ref.get()).data() as TrainingLoadMetadata;
    expect(saved.controls).toEqual({ leg: { override: 0 }, second: { included: false } });
    expect(saved.legs!.leg).toMatchObject({ activityId: changedIdentity ? null : 'renamed',
      identity: { type: ActivityTypes.Walking }, policy: { revision: 4, method: 'MET' } });
    expect(saved.legs!.second).toMatchObject({ activityId: 'second-renamed', policy: { revision: 4, method: 'MET' } });
    expect(saved.sourceFirstImport).toBeUndefined();
    expect(saved.legacyLegs).toBeUndefined();
    expect(resolveEffectiveTrainingLoad({}, saved)).toMatchObject(changedIdentity
      ? { score: null, status: 'unavailable', reasons: ['activity-match-needs-review'] }
      : { score: 0, status: 'available' });
    await finish();
    expect((await ref.get()).data()).toEqual(saved);
  });

  it('keeps a first-import control unmatched when its original leg is missing from the frozen retry snapshot', async () => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    const original = workout(); await prepareTrainingLoadMetadata(uid, original); await source(uid, original);
    const ref = db.doc(metadataPath(uid));
    await ref.update({ controls: { leg: { override: 0 } }, revision: 2 });
    await db.recursiveDelete(db.doc(`users/${uid}/activities/leg`));
    const retry = workout(); retry.getFirstActivity().type = ActivityTypes.Cycling;
    const finish = await prepareTrainingLoadMetadata(uid, retry);
    expect((await ref.get()).data()?.legacyLegs).toEqual({});
    await source(uid, retry); await finish();
    const saved = (await ref.get()).data() as TrainingLoadMetadata;
    expect(saved.legs!.leg).toMatchObject({ activityId: null, identity: { type: 'Unknown', startMs: null } });
    expect(saved.controls).toEqual({ leg: { override: 0 } });
    expect(Object.values(saved.legs!).filter(leg => leg.activityId === 'leg')).toHaveLength(1);
    expect(resolveEffectiveTrainingLoad({}, saved)).toMatchObject({ score: null, reasons: ['activity-match-needs-review'] });
  });

  it('keeps a returning unmatched leg pending review through repeated reparses until explicit reassociation', async () => {
    const uid = setup(); const original = workout(); await importWorkout(uid, original);
    const ref = db.doc(metadataPath(uid));
    await ref.update({ controls: { leg: { override: 0 } }, revision: (await ref.get()).data()!.revision + 1 });
    const current = workout('current', original.endDate.getTime());
    const finishChanged = await prepareTrainingLoadMetadata(uid, current);
    await source(uid, current); await finishChanged();
    expect((await ref.get()).data()?.legs.leg.activityId).toBeNull();

    const returned = workout('returned'); returned.addActivity(current.getActivities()[0]);
    returned.endDate = current.endDate;
    for (let pass = 0; pass < 2; pass++) {
      const finish = await prepareTrainingLoadMetadata(uid, returned);
      await source(uid, returned); await finish();
      const metadata = (await ref.get()).data() as TrainingLoadMetadata;
      expect(Object.keys(metadata.legs!).sort()).toEqual(['current', 'leg', 'returned']);
      expect(metadata.legs!.leg.activityId).toBeNull();
      expect(metadata.controls.leg).toEqual({ override: 0 });
      const [projection] = await attachEventTrainingLoads(uid, [await db.doc(`users/${uid}/events/workout`).get()]);
      expect(attachedEffectiveTrainingLoad(projection.data()!)).toMatchObject({
        score: null, status: 'unavailable', reasons: ['activity-match-needs-review'],
      });
    }
    const before = (await ref.get()).data()!;
    await ref.update({ controls: { leg: { override: 0, activityId: 'returned' } }, revision: before.revision + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await refreshTrainingLoadSummary(uid, 'workout');
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 9, status: 'available' });
    const finish = await prepareTrainingLoadMetadata(uid, returned);
    await source(uid, returned); await finish();
    const metadata = (await ref.get()).data() as TrainingLoadMetadata;
    expect(Object.keys(metadata.legs!).sort()).toEqual(['current', 'leg']);
    expect(metadata.legs!.leg.activityId).toBe('returned');
    expect(metadata.controls.leg).toEqual({ override: 0 });
    expect((await readTrainingLoadSummaries(uid))?.get('workout')?.load).toMatchObject({ score: 9, status: 'available' });
  });

  it('accepts a first-import control created between the source and metadata writes', async () => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    await db.doc(`users/${uid}/trainingLoadPolicies/walking-hiking/revisions/past`).set({
      revision: 1, method: 'MET', included: true, effectiveAt: Timestamp.fromMillis(Date.UTC(2026, 0, 1)) });
    const event = workout(); const finish = await prepareTrainingLoadMetadata(uid, event);
    await source(uid, event);
    // A client edit preserves server-owned preparation fields, as Rules require.
    await db.doc(metadataPath(uid)).update({ revision: 2, controls: { leg: { override: 0 } } });
    await finish();
    const result = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
    expect(result.legs!.leg.policy).toMatchObject({ revision: 1, method: 'MET' });
    expect(resolveEffectiveTrainingLoad({}, result)).toMatchObject({ score: 0, status: 'available' });
  });
  it.each([
    { calibration: 'JSON statistics only', calibrated: false, method: 'MET', score: 9 },
    { calibration: 'explicit library override', calibrated: true, method: 'POWER', score: 100 },
  ])('evaluates uncached power inputs before saving source statistics: $calibration', async ({ calibrated, method, score }) => {
    const uid = setup(); await db.doc(`users/${uid}`).set({ test: true });
    const start = Date.UTC(2026, 0, 2);
    const event = EventImporterJSON.getEventFromJSON({ name: 'Ride', startDate: start, endDate: start + 3600000,
      activities: [{ startDate: start, endDate: start + 3600000, type: ActivityTypes.Cycling,
        creator: { name: 'Test' }, laps: [], intensityZones: [], streams: [],
        stats: { FTP: 200, 'Power Normalized': 200, Duration: 3600, Energy: 210, Weight: 70 } }] } as any);
    event.setID('workout'); event.getActivities()[0].setID('leg');
    if (calibrated) {
      // Exercise the library's compatible explicit override path; QS ingestion
      // supplies no athlete overrides and cannot trust a restored FTP statistic.
      event.getActivities()[0].parseOptions = new ActivityParsingOptions({
        tss: { overrides: { functionalThresholdPower: 200 } },
      });
    }
    // JSON imports do not run the stream/stat generator used by FIT importers.
    // Evaluating their power candidate also derives Power Intensity Factor.
    expect(event.getActivities()[0].getStat('Power Intensity Factor')).toBeUndefined();
    const finish = await prepareTrainingLoadMetadata(uid, event);
    await source(uid, event);
    await finish();
    expect((await db.doc(`users/${uid}/activities/leg`).get()).data()?.stats['Power Intensity Factor'])
      .toBe(calibrated ? 1 : undefined);
    const result = (await db.doc(metadataPath(uid)).get()).data() as TrainingLoadMetadata;
    expect(result.legs!.leg.evaluations?.automatic).toMatchObject({ method, score });
    if (!calibrated) expect(result.legs!.leg.evaluations?.automatic.reasons).toContain('missing-power-inputs');
    const docs = await attachEventTrainingLoads(uid, [(await db.doc(`users/${uid}/events/workout`).get())]);
    expect(attachedEffectiveTrainingLoad(docs[0].data()!)).toMatchObject({ score, status: 'available' });
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
