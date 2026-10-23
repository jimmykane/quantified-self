import { getFunctions } from 'firebase-admin/functions';
import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getUserDeletionGuardState, getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { PROVIDER_MAX_RETRY_COUNT } from '../../shared/queue-config';
import { BILLING_ACCOUNTS, BILLING_CONTROL, BILLING_JOBS, BILLING_REGION, BILLING_TASK, BILLING_LEASE_MS,
  assertLocalBillingEnvironment, billingControl, type BillingJob } from './model';
import { finishBillingJob, observeBilling } from './queue';

export interface BillingTransport {
  enqueue(id: string, generation: number, dueAt: Date): Promise<void>;
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
      if (dueAt.getTime() > Date.now() + 1000) return; // The local recovery command owns later work.
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-CloudTasks-TaskName': `${id}-${generation}`, 'X-CloudTasks-TaskRetryCount': '0',
        'X-CloudTasks-TaskExecutionCount': '1', 'X-CloudTasks-QueueName': BILLING_TASK },
      body: JSON.stringify({ data: { id, generation } }), signal: AbortSignal.timeout(310_000) });
      if (!response.ok) throw new Error('billing_local_task_failed');
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

export async function dispatchBillingJob(db: Firestore, id: string, transport: BillingTransport, recovering = false): Promise<void> {
  if (billingControl((await db.doc(BILLING_CONTROL).get()).data()).owner !== 'native') return;
  const ref = db.collection(BILLING_JOBS).doc(id);
  const job = (await ref.get()).data() as BillingJob | undefined;
  if (!job || job.state !== 'pending' || (job.leaseUntil?.toMillis() ?? 0) > Date.now()) return;
  if (await unavailable(db, job)) {
    await finishBillingJob(db, id, job.generation, 'skipped'); return;
  }
  let missingReservedTask = false;
  if (recovering && job.dispatchedAt) missingReservedTask = !await transport.exists(id, job.generation);
  if (missingReservedTask) {
    const terminalCommitted = await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.get('generation') !== job.generation || current.get('state') !== 'pending'
        || (current.get('leaseUntil')?.toMillis() ?? 0) > Date.now()) return false;
      if (await unavailable(db, job, tx)) return false;
      if (job.attempts >= PROVIDER_MAX_RETRY_COUNT || (job.recoveries ?? 0) >= PROVIDER_MAX_RETRY_COUNT) {
        tx.update(ref, { state: 'failed', error: 'retry_exhausted' });
        tx.set(db.collection('failed_jobs').doc(`stripe_billing_${id}`), {
          serviceName: 'Stripe Billing', uid: job.uid, billingJobId: id, generation: job.generation,
          error: 'retry_exhausted', failedAt: Timestamp.now(), expireAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000),
        });
        return true;
      } else {
        // Absence was verified before rotating the task generation. Application
        // attempts and dueAt survive; a scheduler never resets provider backoff.
        tx.update(ref, { generation: job.generation + 1, recoveries: (job.recoveries ?? 0) + 1, dispatchedAt: FieldValue.delete(), recoverAt: Timestamp.now() });
        return false;
      }
    });
    if (terminalCommitted) observeBilling('terminal_failure');
    return; // The generation-change trigger immediately dispatches the successor.
  }
  try {
    if (!job.dispatchedAt || !recovering) {
      if (await unavailable(db, job) || billingControl((await db.doc(BILLING_CONTROL).get()).data()).owner !== 'native') return;
      try { await transport.enqueue(id, job.generation, job.dueAt.toDate()); }
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
      tx.update(ref, { dispatchedAt: Timestamp.now(), recoverAt: Timestamp.fromMillis(Math.max(Date.now(), job.dueAt.toMillis()) + BILLING_LEASE_MS) });
    });
  } catch { observeBilling('dispatch_failure'); throw new Error('billing_dispatch_failed'); }
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
      if (!deleting && job.dueAt.toMillis() <= Date.now() && (job.leaseUntil?.toMillis() ?? 0) <= Date.now())
        oldest = Math.max(oldest, (Date.now() - Math.max(job.createdAt.toMillis(), job.dueAt.toMillis(), job.leaseUntil?.toMillis() ?? 0)) / 1000);
      await dispatchBillingJob(db, row.id, transport, true);
    }
    observeBilling('heartbeat');
    observeBilling('backlog_age', oldest);
    if (due.size === 50) observeBilling('observation_unknown'); // A capped sample cannot assert global health.
  } catch { observeBilling('observation_unknown'); throw new Error('billing_recovery_failed'); }
}
