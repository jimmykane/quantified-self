import { randomUUID } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ServiceNames } from '@sports-alliance/sports-lib';
import { backfillNotificationRetention } from '../scripts/backfill-notification-retention';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('notification retention migration', { timeout: 30000 }, () => {
  if (process.env.FIRESTORE_EMULATOR_HOST && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Loopback emulator required.');
  const db = new Firestore({ projectId: 'demo-notification-retention' });
  const now = Date.UTC(2026, 10, 18, 12), users: string[] = [];
  let uid: string;
  const meta = () => db.doc(`users/${uid}/meta/${ServiceNames.SuuntoApp}`);
  const ref = (name: string) => db.doc(`users/${uid}/pushState/${name}`);
  beforeEach(async () => {
    uid = randomUUID(); users.push(uid);
    const batch = db.batch(); batch.set(db.doc(`users/${uid}`), {});
    batch.set(ref('activityDelivery'), { deliveryDueAt: now, pending: { deliveryDueAt: now } });
    batch.set(ref('trainingSync'), { trainingDueAt: now + 1, pending: { dueAt: now + 1 } });
    batch.set(ref('trainingSend_workout_w_garmin'), { createdAt: now, members: { private: {} } });
    batch.set(ref('historyCompletion'), { providers: { [ServiceNames.SuuntoApp]: { runId: randomUUID(), createdAt: now - 1000 } } });
    batch.set(meta(), { connectionState: 'connected' });
    batch.set(ref('trainingSync/issues/issue'), { open: true });
    batch.set(db.doc(`users/${uid}/trainingDeliveryLedger/issue`), { workoutId: 'future' });
    batch.set(db.doc(`users/${uid}/scheduledWorkouts/future`), { localDate: '2027-11-18' });
    batch.set(ref('unrelated'), { private: 'leave-alone' });
    await batch.commit();
  });
  afterAll(async () => {
    for (const uid of users) await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.terminate();
  });
  it('defaults to a read-only preview', async () => {
    const result = await backfillNotificationRetention(db, false, now); expect(result.changed).toBeGreaterThan(0);
    expect((await ref('activityDelivery').get()).get('expireAt')).toBeUndefined();
    expect((await meta().get()).get('historyNotificationRunCreatedAtMs')).toBeUndefined();
  });
  it('sets actual Timestamp TTL fields, migrates queue deadlines and preserves replay fences', async () => {
    await backfillNotificationRetention(db, true, now);
    const delivery = await ref('activityDelivery').get(), training = await ref('trainingSync').get();
    expect(delivery.get('dueAt')).toBe(now); expect(delivery.get('deliveryDueAt')).toBeUndefined();
    expect(training.get('dueAt')).toBe(now + 1); expect(training.get('trainingDueAt')).toBeUndefined();
    expect(delivery.get('expireAt')).toBeInstanceOf(Timestamp);
    expect((await ref('trainingSend_workout_w_garmin').get()).get('expireAt').toMillis()).toBe(now + 2 * 86400000);
    expect((await ref('trainingSync/issues/issue').get()).get('expireAt').toMillis()).toBeGreaterThan(Date.UTC(2027, 10, 18));
    expect((await meta().get()).get('historyNotificationRunCreatedAtMs')).toBe(now - 1000);
    expect((await ref('unrelated').get()).data()).toEqual({ private: 'leave-alone' });
    expect((await backfillNotificationRetention(db, true, now)).changed).toBe(0);
  });
  it('repairs legacy history receipts even after a new claim has set TTL, without lowering a newer watermark', async () => {
    await ref('historyCompletion').update({ expireAt: Timestamp.fromMillis(now + 86400000) });
    await backfillNotificationRetention(db, false, now);
    expect((await meta().get()).get('historyNotificationRunCreatedAtMs')).toBeUndefined();
    await backfillNotificationRetention(db, true, now);
    expect((await meta().get()).get('historyNotificationRunCreatedAtMs')).toBe(now - 1000);
    await meta().update({ historyNotificationRunCreatedAtMs: now });
    expect((await backfillNotificationRetention(db, true, now)).changed).toBe(0);
    expect((await meta().get()).get('historyNotificationRunCreatedAtMs')).toBe(now);
  });
  it('does not grant stalled Training requests a fresh lifetime during migration', async () => {
    await ref('trainingSend_workout_w_garmin').update({ createdAt: now - 4 * 86400000 });
    await backfillNotificationRetention(db, true, now);
    expect((await ref('trainingSend_workout_w_garmin').get()).get('expireAt').toMillis()).toBeLessThan(now);
  });
});
