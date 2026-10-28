import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { TrainingDeliveryTransportError } from './contracts';

/** Aggregate app counters contain no user/account identifiers. Account counters live in the user subtree. */
export const TRAINING_PROVIDER_CAPACITY = 'trainingProviderCapacity';
export interface RequestWindow { scope: 'application' | 'account'; limit: number; windowMs: number; bucketMs: number; }
export const GARMIN_PRODUCTION_WINDOWS: readonly RequestWindow[] = [
  { scope: 'application', limit: 3000, windowMs: 60_000, bucketMs: 1000 },
  { scope: 'account', limit: 1000, windowMs: 86_400_000, bucketMs: 60_000 },
];
export const WAHOO_PRODUCTION_WINDOWS: readonly RequestWindow[] = [
  { scope: 'application', limit: 200, windowMs: 300_000, bucketMs: 1000 },
  { scope: 'application', limit: 1000, windowMs: 3_600_000, bucketMs: 10_000 },
  { scope: 'application', limit: 5000, windowMs: 86_400_000, bucketMs: 60_000 },
];
interface Counter { buckets: { at: number; count: number }[]; notBeforeMs: number; }
/** Conservative sliding windows: a bucket is retained until its END leaves the window.
 * This never admits more than the rolling limit; it may defer by at most one bucket. */
export function reserveWindow(counter: Counter | undefined, window: RequestWindow, now: number): { counter: Counter; due: number } {
  const buckets = (counter?.buckets ?? []).filter(bucket => bucket.at + window.bucketMs > now - window.windowMs)
    .map(bucket => ({ ...bucket }));
  const used = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const due = Math.max(counter?.notBeforeMs ?? 0, used >= window.limit ? buckets[0].at + window.bucketMs + window.windowMs : 0);
  if (due > now) return { counter: { buckets, notBeforeMs: counter?.notBeforeMs ?? 0 }, due };
  const at = Math.floor(now / window.bucketMs) * window.bucketMs;
  const current = buckets.find(bucket => bucket.at === at);
  if (current) current.count++;
  else buckets.push({ at, count: 1 });
  return { counter: { buckets, notBeforeMs: 0 }, due: now };
}
export function productionRequestCapacity(db: Firestore, uid: string, provider: PlannedWorkoutProviderId,
  destination: string, windows: readonly RequestWindow[], now: () => number = Date.now) {
  const account = createHash('sha256').update(destination).digest('hex');
  const refs = windows.map(window => (window.scope === 'application' ? db.collection(TRAINING_PROVIDER_CAPACITY)
    : db.collection('users').doc(uid).collection(TRAINING_PROVIDER_CAPACITY))
    .doc(`${provider}_${window.windowMs}_${window.scope === 'application' ? 'app' : account}`));
  return {
    async notBefore(tx: Transaction): Promise<number> {
      const docs = await Promise.all(refs.map(ref => tx.get(ref)));
      return Math.max(now(), ...docs.map((doc, index) => reserveWindow(doc.data() as Counter | undefined, windows[index], now()).due));
    },
    async reserve(): Promise<void> {
      try { await db.runTransaction(async tx => {
        if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) throw new TrainingDeliveryTransportError('auth');
        const docs = await Promise.all(refs.map(ref => tx.get(ref)));
        const time = now();
        const reservations = docs.map((doc, index) => reserveWindow(doc.data() as Counter | undefined, windows[index], time));
        const due = Math.max(time, ...reservations.map(item => item.due));
        if (due > time) throw new TrainingDeliveryTransportError('deferred', due - time);
        reservations.forEach((item, index) => tx.set(refs[index], item.counter));
      }); } catch (error) {
        // Admission failed before any provider request/start journal. Even an ambiguous
        // counter commit only consumes local capacity; it cannot be an uncertain create.
        if (error instanceof TrainingDeliveryTransportError) throw error;
        throw new TrainingDeliveryTransportError('deferred', 60_000);
      }
    },
    async defer(untilMs: number): Promise<void> {
      if (!Number.isSafeInteger(untilMs) || untilMs <= now()) return;
      await db.runTransaction(async tx => {
        if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
        const docs = await Promise.all(refs.map(ref => tx.get(ref)));
        docs.forEach((doc, i) => tx.set(refs[i], { notBeforeMs: Math.max(doc.data()?.notBeforeMs ?? 0, untilMs) }, { merge: true }));
      });
    },
  };
}
