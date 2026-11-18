import { randomUUID } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { backfillNotificationRetention } from '../scripts/backfill-notification-retention';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('notification retention migration', { timeout: 30000 }, () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-notification-retention' });
  const now = Date.UTC(2026, 10, 18, 12), users: string[] = [], runs: string[] = [];
  let uid: string, run: string;
  const ref = (name: string) => db.doc(`users/${uid}/pushState/${name}`);
  beforeEach(async () => {
    uid = randomUUID(); run = randomUUID(); users.push(uid); runs.push(run);
    const batch = db.batch(); batch.set(db.doc(`users/${uid}`), {});
    batch.set(ref('activityDelivery'), { deliveryDueAt: now, pending: { deliveryDueAt: now } });
    batch.set(ref('trainingSync'), { trainingDueAt: now + 1, pending: { dueAt: now + 1 } });
    batch.set(ref('trainingSend_workout_w_garmin'), { createdAt: now, members: { private: {} } });
    batch.set(ref('historyCompletion'), { providers: { suunto: { runId: run } } });
    batch.set(db.doc(`connectionHistoryImports/${run}`), { userID: uid });
    batch.set(ref('trainingSync/issues/issue'), { open: true });
    batch.set(db.doc(`users/${uid}/trainingDeliveryLedger/issue`), { workoutId: 'future' });
    batch.set(db.doc(`users/${uid}/scheduledWorkouts/future`), { localDate: '2027-11-18' });
    batch.set(ref('unrelated'), { private: 'leave-alone' });
    await batch.commit();
  });
  afterAll(async () => {
    for (const uid of users) await db.recursiveDelete(db.doc(`users/${uid}`));
    for (const id of runs) await db.doc(`connectionHistoryImports/${id}`).delete();
    await db.terminate();
  });
  it('defaults to a read-only preview', async () => {
    const result = await backfillNotificationRetention(db, false, now); expect(result.changed).toBeGreaterThan(0);
    expect((await ref('activityDelivery').get()).get('expireAt')).toBeUndefined();
    expect((await db.doc(`connectionHistoryImports/${run}`).get()).get('notificationAttemptedAtMs')).toBeUndefined();
  });
  it('sets actual Timestamp TTL fields, migrates queue deadlines and preserves replay fences', async () => {
    await backfillNotificationRetention(db, true, now);
    const delivery = await ref('activityDelivery').get(), training = await ref('trainingSync').get();
    expect(delivery.get('dueAt')).toBe(now); expect(delivery.get('deliveryDueAt')).toBeUndefined();
    expect(training.get('dueAt')).toBe(now + 1); expect(training.get('trainingDueAt')).toBeUndefined();
    expect(delivery.get('expireAt')).toBeInstanceOf(Timestamp);
    expect((await ref('trainingSend_workout_w_garmin').get()).get('expireAt').toMillis()).toBe(now + 2 * 86400000);
    expect((await ref('trainingSync/issues/issue').get()).get('expireAt').toMillis()).toBeGreaterThan(Date.UTC(2027, 10, 18));
    expect((await db.doc(`connectionHistoryImports/${run}`).get()).get('notificationAttemptedAtMs')).toBe(now);
    expect((await ref('unrelated').get()).data()).toEqual({ private: 'leave-alone' });
    expect((await backfillNotificationRetention(db, true, now)).changed).toBe(0);
  });
  it('does not grant stalled Training requests a fresh lifetime during migration', async () => {
    await ref('trainingSend_workout_w_garmin').update({ createdAt: now - 4 * 86400000 });
    await backfillNotificationRetention(db, true, now);
    expect((await ref('trainingSend_workout_w_garmin').get()).get('expireAt').toMillis()).toBeLessThan(now);
  });
});
