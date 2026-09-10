import { randomUUID } from 'node:crypto';
import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { parseScheduledWorkoutV1, type ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { deliverySettingsId, TRAINING_DELIVERY_PAGE_SIZE, TRAINING_DELIVERY_SETTINGS, TRAINING_DELIVERY_STATUSES,
  type TrainingDeliverySettingsV1, type TrainingDeliveryStatusV1 } from '../../../../shared/training-provider-delivery';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, DELIVERY_SCOPES, DELIVERY_STATE,
  type DeliveryContext, type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { deliveryContentDigest, deliveryIdentity, resolveDeliveryIntent } from './intent';
import { reconciliationJobId } from './marker';

export async function readDeliveryContext(runtime: DeliveryRuntime, tx: Transaction, uid: string,
  workout: ScheduledWorkoutV1 | null, provider: PlannedWorkoutProviderId, hasPro: boolean): Promise<DeliveryContext> {
  const user = runtime.db.collection('users').doc(uid);
  const connection = await runtime.connection(tx, uid, provider);
  const [overrideDoc, settingDoc, scopeDoc, planDoc] = workout ? await Promise.all([
    tx.get(user.collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId('workout', workout.id, provider))),
    workout.planId ? tx.get(user.collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId('plan', workout.planId, provider))) : null,
    tx.get(user.collection(DELIVERY_SCOPES).doc(workout.id)),
    workout.planId ? tx.get(user.collection('trainingPlans').doc(workout.planId)) : null,
  ]) : [null, null, null, null];
  const override = (overrideDoc?.data() ?? null) as TrainingDeliverySettingsV1 | null;
  return { workout, planActive: planDoc?.data()?.lifecycle === 'active',
    setting: workout?.planId ? (settingDoc?.data() ?? null) as TrainingDeliverySettingsV1 | null : override,
    override, scopeGeneration: scopeDoc?.data()?.generation ?? 0, connection, hasPro,
    transport: runtime.transport(provider, uid), nowMs: runtime.now() };
}

export function projectDelivery(ledger: DeliveryLedgerV1): TrainingDeliveryStatusV1 {
  return { schemaVersion: 1, id: ledger.id, workoutId: ledger.workoutId, planId: ledger.planId, provider: ledger.provider,
    status: ledger.status, differsFromQS: !!ledger.actual && (ledger.desired === 'absent'
      || ledger.acceptedContentDigest !== ledger.contentDigest
      || ['unsupported', 'approval_required'].includes(ledger.status)),
    hasRemoteCopy: !!ledger.actual, timeZone: ledger.timeZone, approvalDigest: ledger.approvalDigest,
    issues: ledger.issues, lastAttemptAtMs: ledger.lastAttemptAtMs, lastAcceptedAtMs: ledger.lastAcceptedAtMs,
    retryCount: ledger.retries, nextRetryAtMs: ledger.status === 'retrying' ? ledger.retryAtMs : null,
    updatedAtMs: ledger.updatedAtMs };
}

export function writeDelivery(runtime: DeliveryRuntime, tx: Transaction, uid: string, ledger: DeliveryLedgerV1): void {
  const user = runtime.db.collection('users').doc(uid);
  tx.set(user.collection(DELIVERY_LEDGER).doc(ledger.id), ledger);
  tx.set(user.collection(TRAINING_DELIVERY_STATUSES).doc(ledger.id), projectDelivery(ledger));
}

function reconcileRecord(runtime: DeliveryRuntime, context: DeliveryContext, uid: string, provider: PlannedWorkoutProviderId,
  workoutId: string, previous: DeliveryLedgerV1 | null): DeliveryLedgerV1 | null {
  const setting = context.setting;
  if (!previous && (!setting?.enabled || !context.connection.destinationKey
    || setting.destinationKey !== context.connection.destinationKey || setting.connectionEpoch !== context.connection.epoch)) return null;
  const destinationKey = previous?.destinationKey ?? context.connection.destinationKey;
  const intent = resolveDeliveryIntent(context, previous ?? undefined);
  const id = previous?.id ?? deliveryIdentity(uid, provider, destinationKey, workoutId);
  const settingRevision = Math.max(setting?.revision ?? 0, context.override?.revision ?? 0);
  const changed = !previous || previous.desiredDigest !== intent.digest || previous.desired !== intent.desired;
  const retried = settingRevision !== previous?.settingsRevision;
  const record: DeliveryLedgerV1 = { schemaVersion: 1, id, workoutId, planId: context.workout ? context.workout.planId : previous?.planId ?? null,
    provider, destinationKey,
    desiredGeneration: (previous?.desiredGeneration ?? 0) + (changed ? 1 : 0), desiredDigest: intent.digest,
    connectionEpoch: setting?.connectionEpoch ?? previous?.connectionEpoch ?? context.connection.epoch,
    settingsRevision: settingRevision, desired: intent.desired, status: intent.status, timeZone: intent.timeZone,
    issues: intent.issues, approvalDigest: intent.approvalDigest,
    actual: previous?.actual ?? null, acceptedDigest: previous?.acceptedDigest ?? null,
    contentDigest: deliveryContentDigest(context.workout, intent.timeZone), acceptedContentDigest: previous?.acceptedContentDigest ?? null,
    attempt: previous?.attempt ?? null, lease: previous?.lease ?? null,
    retries: changed || retried ? 0 : previous.retries, retryAtMs: changed || retried ? 0 : previous.retryAtMs,
    blockedConnectionGeneration: previous?.blockedConnectionGeneration ?? null,
    lastAttemptAtMs: previous?.lastAttemptAtMs ?? null, lastAcceptedAtMs: previous?.lastAcceptedAtMs ?? null,
    updatedAtMs: runtime.now() };
  if (record.blockedConnectionGeneration === context.connection.generation) {
    record.status = previous!.status;
    record.desired = 'preserve';
  } else record.blockedConnectionGeneration = null;
  // An uncertain create is never cleared by a new edit or a user Retry.
  if (previous?.status === 'needs_attention' && previous.attempt && !retried) record.status = 'needs_attention';
  if (previous?.status === 'failed' && !changed && !retried) record.status = 'failed';
  if (previous?.status === 'retrying' && !changed && !retried && previous.retryAtMs > runtime.now()) record.status = 'retrying';
  if (record.desired === 'absent' && !record.actual && !record.attempt) record.status = 'removed';
  return record;
}

/** One resumable page. Current workouts and historical delivery identities are separate scans.
 * No page contains more than 25 recipes / 100 compact delivery records. */
export async function reconcileTrainingDeliveryPage(runtime: DeliveryRuntime, uid: string): Promise<boolean> {
  const { db } = runtime;
  const hasPro = await runtime.hasPro(uid);
  const user = db.collection('users').doc(uid);
  const jobRef = db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid));
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return false;
    const [jobDoc, stateDoc, settingsState, locks] = await Promise.all([
      tx.get(jobRef), tx.get(user.collection('trainingPlanState').doc('current')),
      tx.get(user.collection(DELIVERY_STATE).doc('current')),
      tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
    ]);
    if (!jobDoc.exists) return false;
    if (!(settingsState.data()?.revision > 0)) {
      // A never-enrolled author needs no polling. Queue records are leaves by contract.
      tx.delete(jobRef);
      return false;
    }
    if (!locks.empty) { tx.set(jobRef, { dueAtMs: runtime.now() + 60_000 }, { merge: true }); return false; }
    const job = jobDoc.data()!;
    const scanKey = `${job.generation}:${stateDoc.data()?.revision ?? 0}:${settingsState.data()?.revision ?? 0}`;
    const fresh = job.scanKey !== scanKey;
    const phase = fresh ? 'workouts' : job.phase ?? 'workouts';
    const cursor = fresh ? '' : job.cursor ?? '';
    let query = phase === 'workouts'
      ? user.collection('scheduledWorkouts').where('lifecycle', 'in', ['planned', 'skipped']).orderBy(FieldPath.documentId())
      : user.collection(DELIVERY_LEDGER).orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query.limit(TRAINING_DELIVERY_PAGE_SIZE));
    const records: DeliveryLedgerV1[] = [];
    for (const doc of page.docs) {
      if (phase === 'workouts') {
        const workout = parseScheduledWorkoutV1(doc.data());
        for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
          const context = await readDeliveryContext(runtime, tx, uid, workout, provider, hasPro);
          if (!context.setting?.enabled || !context.connection.destinationKey) continue;
          const id = deliveryIdentity(uid, provider, context.connection.destinationKey, workout.id);
          const stored = await tx.get(user.collection(DELIVERY_LEDGER).doc(id));
          const record = reconcileRecord(runtime, context, uid, provider, workout.id, (stored.data() ?? null) as DeliveryLedgerV1 | null);
          if (record) records.push(record);
        }
      } else {
        const previous = doc.data() as DeliveryLedgerV1;
        const workoutDoc = await tx.get(user.collection('scheduledWorkouts').doc(previous.workoutId));
        const context = await readDeliveryContext(runtime, tx, uid, workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null, previous.provider, hasPro);
        const record = reconcileRecord(runtime, context, uid, previous.provider, previous.workoutId, previous);
        if (record) records.push(record);
      }
    }
    for (const record of records) {
      writeDelivery(runtime, tx, uid, record);
      if ((record.attempt || (record.desired === 'present' && record.status !== 'delivered')
        || (record.desired === 'absent' && record.actual)) && !['failed', 'needs_attention'].includes(record.status)) {
        tx.set(db.collection(DELIVERY_QUEUE).doc(record.id), { uid, kind: 'delivery', deliveryId: record.id,
          dueAtMs: Math.max(record.retryAtMs, record.lease?.expiresAtMs ?? 0), dispatchToken: randomUUID() });
      }
    }
    const finished = page.size < TRAINING_DELIVERY_PAGE_SIZE && phase === 'ledger';
    const nextPhase = page.size < TRAINING_DELIVERY_PAGE_SIZE ? 'ledger' : phase;
    tx.set(jobRef, { scanKey: finished ? '' : scanKey, phase: nextPhase,
      cursor: finished || nextPhase !== phase ? '' : page.docs[page.docs.length - 1]?.id ?? '',
      // Daily/horizon/entitlement recovery also runs without an event; no obsolete revisions are replayed.
      dueAtMs: finished ? runtime.now() + 30 * 60_000 : 0, dispatchToken: randomUUID(),
    }, { merge: true });
    return !finished;
  });
}
