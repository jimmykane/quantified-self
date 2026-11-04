import { randomUUID } from 'node:crypto';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { DELIVERY_LEASE_MS, DELIVERY_QUEUE, type DeliveryRuntime } from './contracts';
import { reconciliationJobId } from './marker';

export const RECONCILIATION_BATCH_MS = 60_000;
export const RECONCILIATION_REPAIR_MS = 6 * 60 * 60_000;

export function globalReconciliationGeneration(job: FirebaseFirestore.DocumentData): number {
  // Older deployed writers increment only generation: they still request a full repair.
  return (job.generation ?? 0) - (job.targetedGeneration ?? 0);
}

/** Saved-zone day boundaries include DST and half-hour/date-line time zones. */
export function nextTrainingLocalDay(now: number, timeZone: string): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = day.format(now);
  let low = now; let high = now + 48 * 60 * 60_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (day.format(middle) === today) low = middle;
    else high = middle;
  }
  return high;
}

/** Claim before Auth, recipes, connections or ledgers. A duplicate task costs only this bounded read. */
export async function claimTrainingReconciliation(runtime: DeliveryRuntime, uid: string,
  reservation?: string): Promise<string | null> {
  const ref = runtime.db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid));
  const token = randomUUID();
  return runtime.db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const job = snapshot.data();
    if (!job || job.reconciliationLease?.expiresAtMs > runtime.now()) return null;
    // No-reservation legacy tasks are allowed only until this row uses the new coordinator.
    if (reservation !== undefined && (reservation ? job.dispatchReservation !== reservation : job.coordinatorVersion === 1)) return null;
    if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) {
      tx.delete(ref); return null;
    }
    tx.set(ref, { coordinatorVersion: 1, dispatchReservation: '',
      ...(job.coordinatorVersion !== 1 ? { scanKey: '', cursor: '', nextRepairAtMs: 0 } : {}),
      reconciliationLease: { token, expiresAtMs: runtime.now() + DELIVERY_LEASE_MS },
      dueAtMs: runtime.now() + DELIVERY_LEASE_MS }, { merge: true });
    return token;
  });
}

export async function releaseFailedTrainingReconciliation(runtime: DeliveryRuntime, uid: string, token: string): Promise<void> {
  const ref = runtime.db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid));
  await runtime.db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.data()?.reconciliationLease?.token !== token) return;
    if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) { tx.delete(ref); return; }
    tx.set(ref, { reconciliationLease: null, dueAtMs: runtime.now() + RECONCILIATION_BATCH_MS }, { merge: true });
  });
}
