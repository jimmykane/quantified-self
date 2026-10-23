import { guardedBillingStripe } from './guarded-client';
import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { getCloudTaskRetryBackoffSeconds, PROVIDER_MAX_RETRY_COUNT } from '../../shared/queue-config';
import { BILLING_ACCOUNTS, BILLING_CONTROL, BILLING_JOBS, BILLING_LEASE_MS, BillingContention, BillingError,
  billingControl, billingId, checkoutRequest, RECEIPT_RETENTION_MS, safeBillingError,
  type BillingEvent, type BillingJob } from './model';
import { acquireBillingLease, assertBillingAuthority, commitBillingProjections, createBillingCheckout,
  deleteBillingCustomer, fetchBillingProjections, releaseBillingLease, resolveBillingOwner, type BillingDependencies } from './service';

export type BillingObservation = 'accepted' | 'admission_failure' | 'processed' | 'skipped' | 'processing_failure'
  | 'terminal_failure' | 'checkout_failure' | 'dispatch_failure' | 'heartbeat' | 'backlog_age' | 'observation_unknown';
export function observeBilling(event: BillingObservation, value = 1): void {
  // Low-cardinality telemetry only. Observability must not change ACK/retry semantics.
  try {
    const method = event.endsWith('failure') || event === 'observation_unknown' ? logger.warn : logger.info;
    method('[StripeBilling]', { component: 'stripe_billing', event, value: Math.max(0, value) });
  } catch { /* A failed logger cannot roll back an already committed transaction. */ }
}
function newJob(input: Pick<BillingJob, 'kind' | 'uid' | 'customerId'>, time: number): BillingJob {
  const timestamp = Timestamp.fromMillis(time);
  return { ...input, state: 'pending', createdAt: timestamp, dueAt: timestamp, recoverAt: timestamp, attempts: 0, generation: 0 };
}
export async function admitBillingEvent(db: Firestore, event: BillingEvent, time = Date.now()): Promise<string | null> {
  const uid = event.customerId ? await resolveBillingOwner(db, event.customerId) : null;
  if (event.customerId && !uid) return null;
  if (!event.customerId && !['product', 'price', 'tax_rate'].includes(event.kind)) return null;
  const id = billingId('event', event.eventId);
  const ref = db.collection(BILLING_JOBS).doc(id);
  await db.runTransaction(async tx => {
    const [control, existing] = await tx.getAll(db.doc(BILLING_CONTROL), ref);
    if (control.get('webhooksEnabled') !== true) throw new BillingError('maintenance', true);
    if (existing.exists) return;
    if (uid) {
      const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid);
      const [customer, account] = await tx.getAll(db.doc(`customers/${uid}`), db.collection(BILLING_ACCOUNTS).doc(uid));
      if (guard.shouldSkip || account.get('deleting') || customer.get('stripeId') !== event.customerId) return;
    }
    // The receipt is also the outbox. Its immutable event reference and pending
    // dispatch state commit atomically; no raw provider payload is retained.
    tx.create(ref, { ...newJob({ kind: 'event', uid, customerId: event.customerId }, time), event });
  });
  return id;
}

export async function admitBillingCheckout(db: Firestore, uid: string, requestId: string, data: DocumentData,
  createdAt: Timestamp, local = false): Promise<string | null> {
  const control = billingControl((await db.doc(BILLING_CONTROL).get()).data());
  // Old extension-owned requests must be drained before nativeSince is set.
  if (control.owner !== 'native' || !control.nativeSince || createdAt.toMillis() < control.nativeSince.toMillis()) return null;
  const request = checkoutRequest(data, uid, local);
  const id = billingId('checkout', uid, requestId);
  const ref = db.collection(BILLING_JOBS).doc(id);
  await db.runTransaction(async tx => {
    const [existing, source, account, latestControl] = await tx.getAll(ref,
      db.doc(`customers/${uid}/checkout_sessions/${requestId}`), db.collection(BILLING_ACCOUNTS).doc(uid), db.doc(BILLING_CONTROL));
    const guard = await getUserDeletionGuardStateInTransaction(db, tx, uid);
    const latest = billingControl(latestControl.data());
    if (existing.exists || !source.exists || source.get('sessionId') || guard.shouldSkip || account.get('deleting')) return;
    if (latest.owner !== 'native' || !latest.nativeSince || createdAt.toMillis() < latest.nativeSince.toMillis()) return;
    tx.create(ref, { ...newJob({ kind: 'checkout', uid, customerId: null }, Date.now()), request, requestId });
  });
  return id;
}
export async function writeCheckoutError(db: Firestore, uid: string, requestId: string, error: unknown): Promise<void> {
  await db.runTransaction(async tx => {
    const ref = db.doc(`customers/${uid}/checkout_sessions/${requestId}`);
    const [guard, current, account] = await Promise.all([getUserDeletionGuardStateInTransaction(db, tx, uid), tx.get(ref), tx.get(db.collection(BILLING_ACCOUNTS).doc(uid))]);
    if (!guard.shouldSkip && !account.get('deleting') && current.exists && !current.get('sessionId')) tx.update(ref, { error: safeBillingError(error) });
  });
}
export async function finishBillingJob(db: Firestore, id: string, generation: number, state: 'done' | 'skipped'): Promise<boolean> {
  return db.runTransaction(async tx => {
    const ref = db.collection(BILLING_JOBS).doc(id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.get('generation') !== generation || snapshot.get('state') !== 'pending') return false;
    if (snapshot.get('uid') && (await getUserDeletionGuardStateInTransaction(db, tx, snapshot.get('uid'))).shouldSkip) {
      // Receipt/outbox records are leaves. Account deletion removes identifying
      // receipts immediately; TTL only retains completed events for active users.
      tx.delete(ref);
      return true;
    }
    tx.update(ref, { state, expireAt: Timestamp.fromMillis(Date.now() + RECEIPT_RETENTION_MS),
      lease: FieldValue.delete(), leaseUntil: FieldValue.delete() });
    return true;
  });
}
async function failBillingJob(db: Firestore, id: string, job: BillingJob, error: unknown, time: number): Promise<void> {
  const safe = safeBillingError(error);
  const terminal = job.attempts >= PROVIDER_MAX_RETRY_COUNT || (error instanceof BillingError && !error.retryable);
  const changed = await db.runTransaction(async tx => {
    const ref = db.collection(BILLING_JOBS).doc(id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.get('generation') !== job.generation || snapshot.get('lease') !== job.lease) return false;
    if (job.uid && job.kind !== 'delete') {
      const guard = await getUserDeletionGuardStateInTransaction(db, tx, job.uid);
      const account = await tx.get(db.collection(BILLING_ACCOUNTS).doc(job.uid));
      if (guard.shouldSkip || account.get('deleting')) {
        // Jobs and locks have no children. Operational customer journals are
        // recursively removed only by the dedicated deletion job.
        tx.delete(ref);
        return false;
      }
    }
    if (terminal) {
      tx.update(ref, { state: 'failed', error: safe.code, lease: FieldValue.delete(), leaseUntil: FieldValue.delete() });
      tx.set(db.collection('failed_jobs').doc(`stripe_billing_${id}`), {
        serviceName: 'Stripe Billing', uid: job.uid, billingJobId: id, generation: job.generation,
        error: safe.code, failedAt: Timestamp.fromMillis(time), expireAt: Timestamp.fromMillis(time + RECEIPT_RETENTION_MS),
      });
    } else {
      const dueAt = Timestamp.fromMillis(time + getCloudTaskRetryBackoffSeconds(job.attempts) * 1000);
      tx.update(ref, { error: safe.code, dueAt, recoverAt: Timestamp.fromMillis(dueAt.toMillis() + BILLING_LEASE_MS),
        lease: FieldValue.delete(), leaseUntil: FieldValue.delete() });
    }
    return true;
  });
  if (changed) {
    observeBilling(terminal ? 'terminal_failure' : 'processing_failure');
    if (job.kind === 'checkout') observeBilling('checkout_failure');
  }
  if (changed && !terminal) throw new BillingError('provider_unavailable', true);
}

export async function processBillingJob(ctx: BillingDependencies, id: string, generation: number, transportRetries = 0): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(generation) || generation < 0) throw new BillingError('invalid_request');
  const ref = ctx.db.collection(BILLING_JOBS).doc(id);
  const initial = (await ref.get()).data() as BillingJob | undefined;
  if (!initial || initial.generation !== generation || initial.state !== 'pending') return;
  const control = billingControl((await ctx.db.doc(BILLING_CONTROL).get()).data());
  if (control.owner !== 'native' || !control.nativeSince) return;
  const time = ctx.now?.() ?? Date.now();
  const lease = await acquireBillingLease(ctx.db, initial.uid ? `customer:${initial.uid}` : 'catalog', time);
  let job: BillingJob | null = null;
  try {
    job = await ctx.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.get('generation') !== generation || snapshot.get('state') !== 'pending') return null;
      const current = snapshot.data() as BillingJob;
      if (current.dueAt.toMillis() > time || (current.leaseUntil?.toMillis() ?? 0) > time) throw new BillingContention();
      if (current.uid && current.kind !== 'delete') {
        const guard = await getUserDeletionGuardStateInTransaction(ctx.db, tx, current.uid);
        const account = await tx.get(ctx.db.collection(BILLING_ACCOUNTS).doc(current.uid));
        if (guard.shouldSkip || account.get('deleting')) {
          // Private receipt/outbox records cannot have descendants.
          tx.delete(ref);
          return null;
        }
      }
      const claimed = { ...current, attempts: Math.max(current.attempts, transportRetries) + 1,
        lease: lease.token, leaseUntil: Timestamp.fromMillis(time + BILLING_LEASE_MS) };
      tx.update(ref, claimed);
      return claimed;
    });
    if (!job) return;
    if (job.attempts > PROVIDER_MAX_RETRY_COUNT) throw new BillingError('retry_exhausted');
    if (job.kind === 'delete') {
      await deleteBillingCustomer(ctx, lease, job.uid!);
      if (await finishBillingJob(ctx.db, id, generation, 'done')) observeBilling('processed');
      await ctx.db.recursiveDelete(ctx.db.collection('failed_jobs').doc(`stripe_billing_${id}`));
      return;
    }
    const ownedContext = { ...ctx, stripe: guardedBillingStripe(ctx.stripe, () => assertBillingAuthority(ctx, lease, job!.uid, job!.customerId)) };
    if (job.kind === 'checkout') {
      const { customerId, ...result } = await createBillingCheckout(ownedContext, lease, job.uid!, job.requestId!, job.request!);
      const committed = await commitBillingProjections(ctx, lease, job.uid, customerId, [
        { path: `customers/${job.uid}/checkout_sessions/${job.requestId}`, data: { ...result, error: null, created: Timestamp.fromMillis(time) } },
      ], { ref, generation });
      if (committed) observeBilling('processed');
      else if (await finishBillingJob(ctx.db, id, generation, 'skipped')) observeBilling('skipped');
      return;
    }
    await assertBillingAuthority(ctx, lease, job.uid, job.customerId);
    const projections = await fetchBillingProjections(ownedContext, job.event!, job.uid);
    if (await commitBillingProjections(ctx, lease, job.uid, job.customerId, projections, { ref, generation })) observeBilling('processed');
    else if (await finishBillingJob(ctx.db, id, generation, 'skipped')) observeBilling('skipped');
  } catch (error) {
    if (error instanceof BillingContention || !job) throw error;
    if (error instanceof BillingError && error.code === 'account_unavailable') {
      if (await finishBillingJob(ctx.db, id, generation, 'skipped')) observeBilling('skipped');
      return;
    }
    if (job.kind === 'checkout') await writeCheckoutError(ctx.db, job.uid!, job.requestId!, error);
    await failBillingJob(ctx.db, id, job, error, ctx.now?.() ?? Date.now());
  } finally { await releaseBillingLease(ctx.db, lease); }
}
