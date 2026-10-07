import { sanitizeActivityFirestoreWritePayload, sanitizeEventFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
vi.unmock('firebase-admin');
vi.unmock('@sports-alliance/sports-lib');
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { ActivityTypes, ActivityUtilities, EventImporterJSON, type EventInterface } from '@sports-alliance/sports-lib';
import { persistTrainingLoadMetadata } from './training-load-metadata';
import { attachEventTrainingLoads } from './training-load-reader';
import { attachedEffectiveTrainingLoad, type TrainingLoadMetadata } from '../../../shared/training-load-policy';

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
});
