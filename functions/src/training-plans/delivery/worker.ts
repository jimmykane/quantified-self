import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { getCloudTaskRetryBackoffSeconds, MAX_RETRY_COUNT } from '../../shared/queue-config';
import { DELIVERY_LEDGER, DELIVERY_LEASE_MS, DELIVERY_QUEUE, TrainingDeliveryTransportError,
  type DeliveryArtifact, type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { readDeliveryContext, writeDelivery } from './store';
import { deliveryContentDigest, resolveDeliveryIntent } from './intent';
import { stageTrainingDeliveryReconciliation } from './marker';

function validateArtifact(value: DeliveryArtifact | null): void {
  if (value === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.localDate) || typeof value.completed !== 'boolean'
    || !value.ids || Object.keys(value.ids).length > 16 || Object.entries(value.ids).some(([key, id]) =>
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || typeof id !== 'string' || !id || id.length > 512)) {
    throw new TrainingDeliveryTransportError('uncertain');
  }
}

/** Claim, journal, recheck, transport, acceptance journal. Never trust the dispatched generation. */
export async function processTrainingDelivery(runtime: DeliveryRuntime, uid: string, id: string): Promise<void> {
  const { db } = runtime;
  const user = db.collection('users').doc(uid);
  const ledgerRef = user.collection(DELIVERY_LEDGER).doc(id);
  const jobRef = db.collection(DELIVERY_QUEUE).doc(id);
  const leaseId = randomUUID();
  const startedAt = runtime.now();
  const pro = await runtime.hasPro(uid);
  const claim = await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return null;
    const doc = await tx.get(ledgerRef);
    if (!doc.exists) return null;
    const ledger = doc.data() as DeliveryLedgerV1;
    if (ledger.lease && ledger.lease.expiresAtMs > runtime.now()) return null;
    if (ledger.retryAtMs > runtime.now() || ['failed', 'needs_attention'].includes(ledger.status)) return null;
    const [workoutDoc, locks] = await Promise.all([
      tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId)),
      tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
    ]);
    if (!locks.empty) return null;
    const workout = workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null;
    const context = await readDeliveryContext(runtime, tx, uid, workout, ledger.provider, pro);
    const intent = resolveDeliveryIntent(context, ledger);
    const transport = context.transport;
    if (!transport || context.connection.state !== 'connected' || ledger.destinationKey !== context.connection.destinationKey
      || ledger.connectionEpoch !== context.connection.epoch) {
      ledger.status = !transport ? 'provider_unavailable' : intent.status;
      ledger.lease = null;
      writeDelivery(runtime, tx, uid, ledger);
      tx.delete(jobRef);
      return null;
    }
    const changed = ledger.desiredDigest !== intent.digest || ledger.desired !== intent.desired;
    ledger.desiredGeneration += changed ? 1 : 0;
    ledger.desiredDigest = intent.digest;
    ledger.desired = intent.desired;
    ledger.status = intent.status;
    ledger.issues = intent.issues;
    ledger.approvalDigest = intent.approvalDigest;
    ledger.timeZone = intent.timeZone;
    ledger.contentDigest = deliveryContentDigest(workout, intent.timeZone);
    const recover = !!ledger.attempt;
    if (!ledger.attempt) {
      const kind = intent.desired === 'present' && ledger.acceptedDigest !== intent.digest ? 'upsert'
        : intent.desired === 'absent' && ledger.actual ? 'remove' : null;
      if (!kind) { writeDelivery(runtime, tx, uid, ledger); tx.delete(jobRef); return null; }
      ledger.attempt = { id: randomUUID(), kind, deliveryId: id, generation: ledger.desiredGeneration,
        connectionGeneration: context.connection.generation, destinationKey: ledger.destinationKey,
        timeZone: intent.timeZone, digest: intent.digest, contentDigest: ledger.contentDigest,
        workout: kind === 'upsert' ? workout : null, artifact: ledger.actual };
      tx.create(ledgerRef.collection('attempts').doc(ledger.attempt.id), {
        schemaVersion: 1, operation: ledger.attempt, state: 'started', startedAtMs: runtime.now(),
      });
    } else {
      // Rebind only transport authority, never the stable operation or destination identity.
      // Same-account reconnect was verified above; inspection can now recover the old operation.
      ledger.attempt.connectionGeneration = context.connection.generation;
    }
    ledger.lease = { id: leaseId, expiresAtMs: runtime.now() + DELIVERY_LEASE_MS };
    ledger.lastAttemptAtMs = runtime.now();
    ledger.updatedAtMs = runtime.now();
    writeDelivery(runtime, tx, uid, ledger);
    tx.set(jobRef, { dueAtMs: ledger.lease.expiresAtMs }, { merge: true });
    return { operation: ledger.attempt, provider: ledger.provider, transport, recover };
  });
  if (!claim) return;
  const { operation, transport } = claim;

  const checkpoint = async (artifact: DeliveryArtifact | null, complete = false): Promise<void> => {
    validateArtifact(artifact);
    await db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return;
      const ledger = doc.data() as DeliveryLedgerV1;
      // Record acceptance even when a newer edit or lease arrived during the HTTP call.
      tx.set(ledgerRef.collection('attempts').doc(operation.id), {
        artifact, state: complete ? 'accepted' : 'checkpoint', acceptedAtMs: runtime.now(),
      }, { merge: true });
      if (ledger.attempt?.id !== operation.id) {
        ledger.status = 'needs_attention';
      } else {
        ledger.actual = artifact;
        ledger.attempt.artifact = artifact;
        if (complete) {
          ledger.lastAcceptedAtMs = runtime.now();
          ledger.acceptedDigest = operation.kind === 'upsert' ? operation.digest : null;
          ledger.acceptedContentDigest = operation.kind === 'upsert' ? operation.contentDigest : null;
          ledger.attempt = null;
          ledger.lease = null;
          ledger.retries = 0;
          ledger.retryAtMs = 0;
          ledger.status = ledger.desiredDigest === operation.digest ? operation.kind === 'upsert' ? 'delivered' : 'removed' : 'pending';
        }
      }
      ledger.updatedAtMs = runtime.now();
      writeDelivery(runtime, tx, uid, ledger);
      if (complete) {
        tx.delete(jobRef);
        stageTrainingDeliveryReconciliation(tx, db, uid);
      }
    });
  };

  const abandonProvenUnaccepted = async (): Promise<void> => {
    await db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return;
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== leaseId) return;
      ledger.attempt = null;
      ledger.lease = null;
      ledger.status = 'pending';
      tx.set(ledgerRef.collection('attempts').doc(operation.id), { state: 'not-accepted' }, { merge: true });
      writeDelivery(runtime, tx, uid, ledger);
      stageTrainingDeliveryReconciliation(tx, db, uid);
    });
  };

  let inspectionUncertain = false;
  try {
    // Admission is deliberately repeated immediately before any transport operation.
    const currentPro = await runtime.hasPro(uid);
    const admission = await db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return 'blocked';
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return 'blocked';
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.lease?.id !== leaseId || ledger.attempt?.id !== operation.id) return 'blocked';
      const [workoutDoc, locks] = await Promise.all([
        tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId)),
        tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
      ]);
      const context = await readDeliveryContext(runtime, tx, uid,
        workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null, ledger.provider, currentPro);
      if (!locks.empty || !runtime.transport(ledger.provider, uid) || context.connection.state !== 'connected'
        || context.connection.destinationKey !== operation.destinationKey || context.connection.epoch !== ledger.connectionEpoch
        || context.connection.generation !== operation.connectionGeneration) return 'blocked';
      const intent = resolveDeliveryIntent(context, ledger);
      return (operation.kind === 'upsert' && intent.desired === 'present' && intent.digest === operation.digest)
        || (operation.kind === 'remove' && intent.desired === 'absent') ? 'execute' : 'recover-only';
    });
    if (admission === 'blocked') return; // Lease expiry + dispatcher resumes after valid access; keep operation journal.
    if (claim.recover) {
      const recovery = await transport.recover(operation);
      if (recovery.kind === 'accepted') {
        await checkpoint(recovery.artifact, true);
        logger.info('[TrainingDelivery]', { event: 'recovered_acceptance', provider: claim.provider });
        return;
      }
      if (recovery.kind === 'uncertain') { inspectionUncertain = true; throw new TrainingDeliveryTransportError('uncertain'); }
    }
    if (admission === 'recover-only') {
      await abandonProvenUnaccepted();
      logger.info('[TrainingDelivery]', { event: 'stale_suppressed', provider: claim.provider });
      return;
    }
    const artifact = await transport.execute(operation, artifact => checkpoint(artifact));
    await checkpoint(artifact, true);
    logger.info('[TrainingDelivery]', { event: 'accepted', provider: claim.provider, operation: operation.kind,
      latencyMs: runtime.now() - startedAt });
  } catch (error) {
    const failure = error instanceof TrainingDeliveryTransportError ? error : new TrainingDeliveryTransportError('uncertain');
    let retryCount = 0;
    await db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return;
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== leaseId) return;
      ledger.lease = null;
      ledger.retries += 1;
      retryCount = ledger.retries;
      ledger.status = failure.kind === 'auth' ? 'reconnect_required' : failure.kind === 'permission' ? 'connection_repair'
        : failure.kind === 'uncertain' ? inspectionUncertain || ledger.retries >= MAX_RETRY_COUNT ? 'needs_attention' : 'retrying'
          : failure.kind === 'terminal' || ledger.retries >= MAX_RETRY_COUNT ? 'failed' : 'retrying';
      ledger.blockedConnectionGeneration = ['auth', 'permission'].includes(failure.kind) ? operation.connectionGeneration : null;
      ledger.retryAtMs = runtime.now() + Math.max(getCloudTaskRetryBackoffSeconds(ledger.retries) * 1000, failure.retryAfterMs);
      ledger.updatedAtMs = runtime.now();
      writeDelivery(runtime, tx, uid, ledger);
      if (ledger.status === 'retrying') tx.set(jobRef, { uid, kind: 'delivery', deliveryId: id, dueAtMs: ledger.retryAtMs, dispatchToken: randomUUID() });
      else tx.delete(jobRef);
    });
    logger.warn('[TrainingDelivery]', { event: 'failure', provider: claim.provider, category: failure.kind,
      retryCount, latencyMs: runtime.now() - startedAt });
  }
}
