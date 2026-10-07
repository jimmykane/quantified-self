import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.unmock('firebase-admin');
vi.unmock('@sports-alliance/sports-lib');
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ActivityTypes, ActivityUtilities, EventImporterJSON, type EventInterface } from '@sports-alliance/sports-lib';
import { persistTrainingLoadMetadata, prepareTrainingLoadMetadata } from './training-load-metadata';
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
    expect(resolveEffectiveTrainingLoad({}, prepared, [{ id: 'leg', type: ActivityTypes.Walking }]).score).toBe(12.3);
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
