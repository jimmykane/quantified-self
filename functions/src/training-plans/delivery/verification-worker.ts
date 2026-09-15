import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { DELIVERY_LEDGER, DELIVERY_LEASE_MS, DELIVERY_QUEUE, TrainingDeliveryTransportError,
  type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { resolveDeliveryIntent } from './intent';
import { readDeliveryContext, writeDelivery } from './store';
import { inspectionBinding, observeInspection } from './verification-evidence';
import { emptyVerification } from './verification-queue';
import { VERIFICATION_DAY_MS, type InspectionObservation } from './verification-contracts';
import { stageTrainingDeliveryReconciliation } from './marker';

/** Shares the delivery lease. No HTTP is performed inside a transaction. */
export async function processTrainingVerification(runtime: DeliveryRuntime, uid: string, id: string): Promise<void> {
  const user = runtime.db.collection('users').doc(uid);
  const ref = user.collection(DELIVERY_LEDGER).doc(id);
  const job = runtime.db.collection(DELIVERY_QUEUE).doc(id);
  const leaseId = randomUUID();
  const startedAt = runtime.now();
  const pro = await runtime.hasPro(uid);
  const claim = await runtime.db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) return null;
    const [doc, jobDoc, locks] = await Promise.all([tx.get(ref), tx.get(job),
      tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1))]);
    if (!doc.exists || jobDoc.data()?.kind !== 'verification' || !locks.empty) return null;
    const ledger = doc.data() as DeliveryLedgerV1;
    if (ledger.lease && ledger.lease.expiresAtMs > runtime.now()) return null;
    const workout = await tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId));
    const context = await readDeliveryContext(runtime, tx, uid,
      workout.exists ? parseScheduledWorkoutV1(workout.data()) : null, ledger.provider, pro, ledger.workoutId);
    const intent = resolveDeliveryIntent(context, ledger);
    const inspection = context.transport?.inspection;
    if (!inspection || inspection.policy.mode === 'unavailable' || !ledger.actual || ledger.attempt
      || intent.desired !== 'present' || (intent.status !== 'delivered' && !ledger.verification?.missing) || ledger.desiredDigest !== intent.digest) {
      tx.delete(job); stageTrainingDeliveryReconciliation(tx, runtime.db, uid); return null;
    }
    const evidence = ledger.verification ?? emptyVerification(runtime.now());
    if (evidence.nextCheckAtMs > runtime.now()) {
      tx.set(job, { dueAtMs: evidence.nextCheckAtMs }, { merge: true }); return null;
    }
    const binding = inspectionBinding(ledger, context, inspection.policy);
    ledger.verification = { ...evidence, state: 'checking' };
    ledger.lease = { id: leaseId, expiresAtMs: runtime.now() + DELIVERY_LEASE_MS };
    writeDelivery(runtime, tx, uid, ledger);
    tx.set(job, { dueAtMs: ledger.lease.expiresAtMs }, { merge: true });
    return { ledger, binding, inspection, connectionGeneration: context.connection.generation };
  });
  if (!claim) return;
  const guard = async () => {
    const currentPro = await runtime.hasPro(uid);
    await runtime.db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) throw new TrainingDeliveryTransportError('auth');
      const [doc, locks] = await Promise.all([tx.get(ref), tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1))]);
      if (!doc.exists || !locks.empty) throw new TrainingDeliveryTransportError('deferred', 60_000);
      const ledger = doc.data() as DeliveryLedgerV1;
      const workout = await tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId));
      const context = await readDeliveryContext(runtime, tx, uid,
        workout.exists ? parseScheduledWorkoutV1(workout.data()) : null, ledger.provider, currentPro, ledger.workoutId);
      const intent = resolveDeliveryIntent(context, ledger);
      if (ledger.lease?.id !== leaseId || ledger.lease.expiresAtMs <= runtime.now() || ledger.attempt
        || intent.desired !== 'present' || intent.digest !== ledger.desiredDigest
        || (intent.status !== 'delivered' && !ledger.verification?.missing) || !context.transport?.inspection
        || context.transport.inspection.policy.mode === 'unavailable'
        || context.transport.inspection.policy.version !== claim.inspection.policy.version
        || inspectionBinding(ledger, context, context.transport.inspection.policy) !== claim.binding) throw new TrainingDeliveryTransportError('deferred', 60_000);
    });
  };
  let observation: InspectionObservation = { artifacts: [], conflict: false };
  let failure: TrainingDeliveryTransportError | undefined;
  try {
    const result = await claim.inspection.inspect({ artifact: claim.ledger.actual!, destinationKey: claim.ledger.destinationKey,
      connectionGeneration: claim.connectionGeneration, timeZone: claim.ledger.timeZone,
      cursor: claim.ledger.verification?.binding === claim.binding ? claim.ledger.verification.cursor : null }, guard);
    if (!result || typeof result !== 'object' || !Array.isArray(result.artifacts)) throw new TrainingDeliveryTransportError('retryable');
    observation = result;
    await guard();
  } catch (error) { failure = error instanceof TrainingDeliveryTransportError ? error : new TrainingDeliveryTransportError('retryable'); }
  const currentPro = await runtime.hasPro(uid);
  const outcome = await runtime.db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) return;
    const doc = await tx.get(ref);
    if (!doc.exists) return;
    const ledger = doc.data() as DeliveryLedgerV1;
    if (ledger.lease?.id !== leaseId) return; // A late read can never overwrite another lease's evidence.
    const [workout, locks] = await Promise.all([tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId)),
      tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1))]);
    const context = await readDeliveryContext(runtime, tx, uid,
      workout.exists ? parseScheduledWorkoutV1(workout.data()) : null, ledger.provider, currentPro, ledger.workoutId);
    const intent = resolveDeliveryIntent(context, ledger);
    const current = locks.empty && !ledger.attempt && ledger.lease.expiresAtMs > runtime.now() && intent.desired === 'present'
      && intent.digest === ledger.desiredDigest
      && (intent.status === 'delivered' || ledger.verification?.missing) && context.transport?.inspection?.policy.version === claim.inspection.policy.version
      && context.transport.inspection.policy.mode !== 'unavailable'
      && inspectionBinding(ledger, context, context.transport.inspection.policy) === claim.binding;
    ledger.lease = null;
    if (!current) {
      ledger.verification = { ...(ledger.verification ?? emptyVerification(runtime.now())), state: 'pending', nextCheckAtMs: runtime.now() };
      writeDelivery(runtime, tx, uid, ledger);
      tx.delete(job); stageTrainingDeliveryReconciliation(tx, runtime.db, uid); return;
    }
    const evidence = observeInspection(ledger.verification, claim.binding, claim.inspection.policy, observation, runtime.now());
    if (failure) {
      evidence.state = failure.kind === 'deferred' ? 'deferred' : 'unknown';
      evidence.nextCheckAtMs = runtime.now() + Math.max(failure.retryAfterMs, failure.kind === 'deferred' ? 60_000 : VERIFICATION_DAY_MS);
      if (failure.kind === 'deferred') {
        evidence.checkedAtMs = ledger.verification?.checkedAtMs ?? null;
        evidence.manualPending = ledger.verification?.manualPending ?? false;
      }
    } else if (evidence.cursor) evidence.nextCheckAtMs = runtime.now() + 60_000;
    ledger.verification = evidence;
    ledger.updatedAtMs = runtime.now();
    if (evidence.state === 'present') { ledger.status = intent.status; ledger.issues = intent.issues; }
    if (failure && ['auth', 'permission'].includes(failure.kind)) {
      ledger.status = failure.kind === 'auth' ? 'reconnect_required' : 'connection_repair';
      ledger.blockedConnectionGeneration = claim.connectionGeneration;
      ledger.issues = ['Check provider access and Training permission in Connectivity before checking again.'];
    }
    if (observation.conflict) {
      ledger.status = 'needs_attention';
      ledger.issues = ['The provider copy has a different date, owner or association. Review it before syncing again.'];
    }
    if (observation.completed === true && !failure) {
      ledger.actual = { ...ledger.actual!, completed: true };
      ledger.status = 'completed'; ledger.desired = 'preserve';
    }
    const repairReady = evidence.state === 'confirmed_missing' && claim.inspection.policy.repairReady && !ledger.actual?.completed;
    if (repairReady && evidence.repairTimes.length >= 2) {
      evidence.state = 'deferred'; evidence.nextCheckAtMs = evidence.repairTimes[0] + VERIFICATION_DAY_MS;
    } else if (repairReady) {
      ledger.repair = { policyVersion: claim.inspection.policy.version, binding: claim.binding,
        missing: evidence.missingKeys, original: ledger.actual! };
      ledger.acceptedDigest = null;
      ledger.status = 'pending';
      evidence.state = 'restoring';
    }
    // Inspection evidence is immutable and private. It contains no provider response payload.
    tx.create(ref.collection('inspections').doc(leaseId), { binding: claim.binding, atMs: runtime.now(),
      state: evidence.state, missing: evidence.missingKeys, coverage: observation.coverage ? {
        complete: observation.coverage.complete === true, stable: observation.coverage.stable === true,
        filtered: observation.coverage.filtered !== false, nextCursor: evidence.cursor,
      } : null });
    writeDelivery(runtime, tx, uid, ledger);
    if (ledger.repair && evidence.state === 'restoring') {
      tx.set(job, { uid, kind: 'delivery', deliveryId: id, dueAtMs: 0, dispatchToken: randomUUID() });
    } else if (['needs_attention', 'completed', 'reconnect_required', 'connection_repair'].includes(ledger.status)) tx.delete(job);
    else tx.set(job, { uid, kind: 'verification', priority: evidence.manualPending ? 'manual' : 'ordinary', deliveryId: id,
      dueAtMs: evidence.nextCheckAtMs, dispatchToken: randomUUID() });
    return evidence.state;
  });
  logger.info('[TrainingVerification]', { event: failure ? 'check_deferred_or_failed' : 'checked',
    provider: claim.ledger.provider, category: failure?.kind ?? 'observation',
    outcome: outcome ?? 'stale_suppressed',
    coverage: !failure && observation.artifacts.length === claim.inspection.policy.required.length
      && (claim.inspection.policy.mode === 'retained-ids' || observation.coverage?.complete === true), latencyMs: runtime.now() - startedAt });
}
