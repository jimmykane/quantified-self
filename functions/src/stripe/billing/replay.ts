import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { BILLING_ACCOUNTS, BILLING_JOBS, BillingError } from './model';

/** Explicit operator replay retains every Stripe operation and idempotency key. */
export async function replayBillingJob(db: Firestore, id: string, execute = false): Promise<'eligible' | 'requeued' | 'ineligible'> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new BillingError('invalid_request');
  return db.runTransaction(async tx => {
    const ref = db.collection(BILLING_JOBS).doc(id);
    const row = await tx.get(ref);
    if (!row.exists || row.get('state') !== 'failed' || (row.get('leaseUntil')?.toMillis() ?? 0) > Date.now()) return 'ineligible';
    if (row.get('uid') && row.get('kind') !== 'delete') {
      const guard = await getUserDeletionGuardStateInTransaction(db, tx, row.get('uid'));
      const account = await tx.get(db.collection(BILLING_ACCOUNTS).doc(row.get('uid')));
      if (guard.shouldSkip || account.get('deleting')) return 'ineligible';
    }
    if (!execute) return 'eligible';
    tx.update(ref, { state: 'pending', generation: row.get('generation') + 1, recoveries: 0, attempts: 0,
      dueAt: Timestamp.now(), recoverAt: Timestamp.now(), dispatchedAt: FieldValue.delete(), dispatchRetryAt: FieldValue.delete(),
      lease: FieldValue.delete(), leaseUntil: FieldValue.delete(), error: FieldValue.delete(), expireAt: FieldValue.delete() });
    return 'requeued';
  });
}
