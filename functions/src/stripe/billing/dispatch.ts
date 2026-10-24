import { getFunctions } from 'firebase-admin/functions';
import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { getCloudTaskRetryBackoffSeconds, PROVIDER_MAX_RETRY_COUNT } from '../../shared/queue-config';
import { BILLING_ACCOUNTS, BILLING_CONTROL, BILLING_JOBS, BILLING_REGION, BILLING_TASK, BILLING_LEASE_MS,
  BillingError, assertLocalBillingEnvironment, billingControl, safeBillingError, type BillingJob } from './model';
import { finishBillingJob, observeBilling } from './queue';

export interface BillingTransport {
  // Local future work stays in the outbox; it has no task reservation yet.
  enqueue(id: string, generation: number, dueAt: Date): Promise<void | 'deferred'>;
  exists(id: string, generation: number): Promise<boolean>;
}
export function billingTransport(): BillingTransport {
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.QS_BILLING_LOCAL === 'true') {
    assertLocalBillingEnvironment(process.env);
    // Use the task HTTP protocol on loopback exclusively; durable pending
    // rows own interrupted local retries. Never fall back to a cloud queue.
    const host = process.env.QS_BILLING_FUNCTIONS_HOST ?? '127.0.0.1:5001';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Loopback Functions required.');
    const url = `http://${host}/${process.env.GCLOUD_PROJECT}/${BILLING_REGION}/${BILLING_TASK}`;
    return { exists: async () => false, enqueue: async (id, generation, dueAt) => {
      if (dueAt.getTime() > Date.now()) return 'deferred'; // The local recovery command owns later work.
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-CloudTasks-TaskName': `${id}-${generation}`, 'X-CloudTasks-TaskRetryCount': '0',
        'X-CloudTasks-TaskExecutionCount': '1', 'X-CloudTasks-QueueName': BILLING_TASK },
      body: JSON.stringify({ data: { id, generation } }), signal: AbortSignal.timeout(310_000) });
      if (!response.ok) throw new Error('billing_local_task_failed');
      return undefined;
    } };
  }
  const project = process.env.GCLOUD_PROJECT;
  if (!project || project.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Invalid billing task environment.');
  const queue = getFunctions().taskQueue(`locations/${BILLING_REGION}/functions/${BILLING_TASK}`);
  return {
    enqueue: (id, generation, dueAt) => queue.enqueue({ id, generation }, { id: `${id}-${generation}`, scheduleTime: dueAt, dispatchDeadlineSeconds: 300 }),
    exists: async (id, generation) => {
      const { v2beta3 } = await import('@google-cloud/tasks');
      const client = new v2beta3.CloudTasksClient();
      try {
        await client.getTask({ name: `projects/${project}/locations/${BILLING_REGION}/queues/${BILLING_TASK}/tasks/${id}-${generation}` });
        return true;
      } catch (error) { if ((error as { code?: number }).code === 5) return false; throw error; }
      finally { await client.close(); }
    },
  };
}
function duplicate(error: unknown): boolean { return ['functions/task-already-exists', 6, 'already-exists'].includes((error as { code: string | number })?.code); }

async function unavailable(db: Firestore, job: BillingJob, tx?: Transaction): Promise<boolean> {
  if (!job.uid || job.kind === 'delete') return false;
  const ref = db.collection(BILLING_ACCOUNTS).doc(job.uid);
  const [guard, account] = await Promise.all([
    tx ? getUserDeletionGuardStateInTransaction(db, tx, job.uid) : getUserDeletionGuardState(db, job.uid),
    tx ? tx.get(ref) : ref.get(),
  ]);
  return guard.shouldSkip || account.get('deleting') === true;
}

async function writeTerminalDispatchFailure(db: Firestore, tx: Transaction, id: string, job: BillingJob, time: number): Promise<void> {
  if (job.kind === 'checkout') {
    const request = db.doc(`customers/${job.uid}/checkout_sessions/${job.requestId}`);
    const snapshot = await tx.get(request);
    if (snapshot.exists && !snapshot.get('sessionId')) tx.update(request, { error: safeBillingError(new BillingError('retry_exhausted')) });
  }
  tx.set(db.collection('failed_jobs').doc(`stripe_billing_${id}`), {
    serviceName: 'Stripe Billing', uid: job.uid, billingJobId: id, generation: job.generation,
    error: 'retry_exhausted', failedAt: Timestamp.fromMillis(time), expireAt: Timestamp.fromMillis(time + 30 * 86_400_000),
  });
}

export async function dispatchBillingJob(db: Firestore, id: string, transport: BillingTransport, recovering = false): Promise<void> {
  if (billingControl((await db.doc(BILLING_CONTROL).get()).data()).owner !== 'native') return;
  const ref = db.collection(BILLING_JOBS).doc(id);
  const job = (await ref.get()).data() as BillingJob | undefined;
  if (!job || job.state !== 'pending' || (job.leaseUntil?.toMillis() ?? 0) > Date.now()
    || (job.dispatchRetryAt?.toMillis() ?? 0) > Date.now()) return;
  if (await unavailable(db, job)) {
    await finishBillingJob(db, id, job.generation, 'skipped'); return;
  }
  try {
    let missingReservedTask = false;
    if (recovering && job.dispatchedAt) missingReservedTask = !await transport.exists(id, job.generation);
    if (missingReservedTask) {
      const terminalCommitted = await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.get('generation') !== job.generation || current.get('state') !== 'pending'
          || (current.get('leaseUntil')?.toMillis() ?? 0) > Date.now()) return false;
        if (await unavailable(db, job, tx)) return false;
        if (current.get('attempts') >= PROVIDER_MAX_RETRY_COUNT || (current.get('recoveries') ?? 0) >= PROVIDER_MAX_RETRY_COUNT) {
          await writeTerminalDispatchFailure(db, tx, id, job, Date.now());
          tx.update(ref, { state: 'failed', error: 'retry_exhausted' });
          return true;
        } else {
          // Absence was verified before rotating the task generation. Application
          // attempts and dueAt survive; a scheduler never resets provider backoff.
          tx.update(ref, { generation: job.generation + 1, recoveries: (current.get('recoveries') ?? 0) + 1,
            dispatchedAt: FieldValue.delete(), dispatchRetryAt: FieldValue.delete(), recoverAt: Timestamp.now() });
          return false;
        }
      });
      if (terminalCommitted) {
        observeBilling('terminal_failure');
        if (job.kind === 'checkout') observeBilling('checkout_failure');
      }
      return; // The generation-change trigger immediately dispatches the successor.
    }
    let deferred = false;
    if (!job.dispatchedAt || !recovering) {
      if (await unavailable(db, job) || billingControl((await db.doc(BILLING_CONTROL).get()).data()).owner !== 'native') return;
      try { deferred = await transport.enqueue(id, job.generation, job.dueAt.toDate()) === 'deferred'; }
      catch (error) {
        if (!duplicate(error)) throw error;
        if (!await transport.exists(id, job.generation)) {
          // Retain the reservation marker so the bounded recovery path verifies
          // absence and rotates once. Never report an absent task as accepted.
          await db.runTransaction(async tx => {
            const current = await tx.get(ref);
            if (await unavailable(db, job, tx)) return;
            if (current.get('generation') === job.generation && current.get('state') === 'pending')
              tx.update(ref, { dispatchedAt: Timestamp.now(), recoverAt: Timestamp.now() });
          });
          return;
        }
      }
    }
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.exists || current.get('generation') !== job.generation || current.get('state') !== 'pending') return;
      if (await unavailable(db, job, tx)) return;
      if (deferred) {
        if ((current.get('leaseUntil')?.toMillis() ?? 0) > Date.now()) return;
        // Do not invent a reservation or add a lease-length delay for local
        // work that was never sent. Recovery can deliver the same generation
        // when due, without charging it as a missing Cloud Tasks reservation.
        tx.update(ref, { dispatchedAt: FieldValue.delete(), recoverAt: Timestamp.fromMillis(
          Math.max(current.get('dueAt').toMillis(), current.get('dispatchRetryAt')?.toMillis() ?? 0)) });
        return;
      }
      tx.update(ref, { dispatchedAt: Timestamp.now(), dispatchRetryAt: FieldValue.delete(),
        recoverAt: Timestamp.fromMillis(Math.max(Date.now(), current.get('dueAt').toMillis()) + BILLING_LEASE_MS) });
    });
  } catch {
    // Enqueue/getTask failures need the same durable, bounded recovery as lost
    // reservations. A persisted backoff owns the next attempt; only failure to
    // save that recovery state should ask Eventarc to redeliver immediately.
    const result = await db.runTransaction(async tx => {
      const [current, control] = await tx.getAll(ref, db.doc(BILLING_CONTROL));
      const time = Date.now();
      if (current.get('generation') !== job.generation || current.get('state') !== 'pending'
        || billingControl(control.data()).owner !== 'native'
        || (current.get('leaseUntil')?.toMillis() ?? 0) > time
        || (current.get('dispatchRetryAt')?.toMillis() ?? 0) > time
        || await unavailable(db, job, tx)) return null;
      const recoveries = (current.get('recoveries') ?? 0) + 1;
      if (recoveries >= PROVIDER_MAX_RETRY_COUNT) {
        await writeTerminalDispatchFailure(db, tx, id, job, time);
        tx.update(ref, { recoveries, state: 'failed', error: 'retry_exhausted' });
        return 'terminal';
      }
      const dispatchRetryAt = Timestamp.fromMillis(time + getCloudTaskRetryBackoffSeconds(recoveries) * 1000);
      tx.update(ref, { recoveries, dispatchRetryAt, recoverAt: dispatchRetryAt });
      return 'retry';
    });
    if (result) observeBilling('dispatch_failure');
    if (result === 'terminal') {
      observeBilling('terminal_failure');
      if (job.kind === 'checkout') observeBilling('checkout_failure');
    }
  }
}

export async function recoverBillingJobs(db: Firestore, transport: BillingTransport): Promise<void> {
  if (billingControl((await db.doc(BILLING_CONTROL).get()).data()).owner !== 'native') return;
  try {
    const due = await db.collection(BILLING_JOBS).where('state', '==', 'pending')
      .where('recoverAt', '<=', Timestamp.now()).orderBy('recoverAt').limit(50).get();
    let oldest = 0;
    for (const row of due.docs) {
      const job = row.data() as BillingJob;
      const deleting = await unavailable(db, job);
      if (!deleting && job.dueAt.toMillis() <= Date.now() && (job.leaseUntil?.toMillis() ?? 0) <= Date.now()
        && (job.dispatchRetryAt?.toMillis() ?? 0) <= Date.now())
        oldest = Math.max(oldest, (Date.now() - Math.max(job.createdAt.toMillis(), job.dueAt.toMillis(), job.leaseUntil?.toMillis() ?? 0, job.dispatchRetryAt?.toMillis() ?? 0)) / 1000);
      await dispatchBillingJob(db, row.id, transport, true);
    }
    observeBilling('heartbeat');
    observeBilling('backlog_age', oldest);
    if (due.size === 50) observeBilling('observation_unknown'); // A capped sample cannot assert global health.
  } catch { observeBilling('observation_unknown'); throw new Error('billing_recovery_failed'); }
}
