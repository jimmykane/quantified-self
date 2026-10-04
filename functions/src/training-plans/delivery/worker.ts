import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { trainingDeliveryLocalDate } from '../../../../shared/training-provider-delivery';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { getCloudTaskRetryBackoffSeconds, MAX_RETRY_COUNT } from '../../shared/queue-config';
import { DELIVERY_LEDGER, DELIVERY_LEASE_MS, DELIVERY_QUEUE, TrainingDeliveryTransportError,
  type DeliveryArtifact, type DeliveryLedgerV1, type DeliveryRuntime, type DeliveryTransportProgress } from './contracts';
import { readDeliveryContext, writeDelivery } from './store';
import { deliveryContentDigest, resolveDeliveryIntent } from './intent';
import { stageTrainingDeliveryReconciliation } from './marker';
import { inspectionBinding } from './verification-evidence';
import { canExecuteDeliveryRepair, VERIFICATION_DAY_MS } from './verification-contracts';
import { emptyVerification } from './verification-queue';
import { deliveryDiagnosticLabels, deliveryDiagnosticMapping, observeDeliveryCheckpoint, type DeliveryDiagnosticPhase } from './diagnostics';
import { processTrainingDeliveryBatch } from './batch-worker';
import { recoverWahooWithdrawalGeneration, wahooArtifactGeneration, wahooPlanGeneration } from './wahoo/identity';

function validateArtifact(value: DeliveryArtifact | null): void {
  if (value === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.localDate) || typeof value.completed !== 'boolean'
    || !value.ids || Array.isArray(value.ids) || Object.keys(value.ids).length < 1 || Object.keys(value.ids).length > 16
    || Object.entries(value.ids).some(([key, id]) =>
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
  const seedLedger = await ledgerRef.get();
  if (seedLedger.exists) {
    const seed = seedLedger.data() as DeliveryLedgerV1;
    const seedTransport = runtime.transport(seed.provider, uid);
    if (seedTransport?.batch) {
      await processTrainingDeliveryBatch(runtime, uid, id, seed.provider, seedTransport);
      return;
    }
  }
  const leaseId = randomUUID();
  const startedAt = runtime.now();
  const pro = await runtime.hasPro(uid);
  const claim = await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return null;
    const doc = await tx.get(ledgerRef);
    if (!doc.exists) return null;
    const ledger = doc.data() as DeliveryLedgerV1;
    if (ledger.lease && ledger.lease.expiresAtMs > runtime.now()) return null;
    if (ledger.retryAtMs > runtime.now() || ledger.providerAccessBlocked || ['failed', 'needs_attention'].includes(ledger.status)) return null;
    const [workoutDoc, locks] = await Promise.all([
      tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId)),
      tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
    ]);
    if (!locks.empty) return null;
    const workout = workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null;
    const context = await readDeliveryContext(runtime, tx, uid, workout, ledger.provider, pro, ledger.workoutId, ledger);
    const intent = resolveDeliveryIntent(context, ledger);
    const transport = context.transport;
    if (!transport || context.connection.state !== 'connected' || ledger.destinationKey !== context.connection.destinationKey
      || ledger.connectionEpoch !== context.connection.epoch || ledger.blockedConnectionGeneration === context.connection.generation) {
      ledger.status = !transport ? 'provider_unavailable' : intent.status;
      ledger.issues = intent.issues;
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
    ledger.contentDigest = deliveryContentDigest(workout, intent.timeZone, context.strength);
    // Keep authorization evidence separate from acceptance: retiring an old
    // unaccepted attempt must not erase a verified presentation-only upgrade.
    if (intent.mappingApprovalProof) ledger.mappingApprovalProof = intent.mappingApprovalProof;
    if (ledger.provider === 'wahoo') {
      if (ledger.wahooPlanGeneration !== undefined) wahooPlanGeneration(ledger.wahooPlanGeneration);
      const recoveredGeneration = await recoverWahooWithdrawalGeneration(tx, ledgerRef, ledger);
      if (recoveredGeneration !== undefined) {
        ledger.wahooPlanGeneration = recoveredGeneration;
        if (ledger.attempt) {
          // progress=null and artifact=null prove this legacy attempt made no
          // provider write. Retire it rather than rewriting an immutable identity.
          tx.set(ledgerRef.collection('attempts').doc(ledger.attempt.id), { state: 'not-accepted' }, { merge: true });
          ledger.attempt = null;
        }
      }
    }
    const recover = !!ledger.attempt;
    if (!ledger.attempt) {
      const kind = intent.desired === 'present' && ledger.acceptedDigest !== intent.digest ? 'upsert'
        : intent.desired === 'absent' && (ledger.actual || ledger.repair) ? 'remove' : null;
      if (!kind) { writeDelivery(runtime, tx, uid, ledger); tx.delete(jobRef); return null; }
      if (kind === 'upsert' && ledger.repair?.continuation) {
        const policy = transport.inspection?.policy;
        if (!ledger.actual || !policy || !canExecuteDeliveryRepair(policy, ledger.repair)) {
          ledger.status = 'provider_unavailable';
          writeDelivery(runtime, tx, uid, ledger); tx.delete(jobRef); return null;
        }
        // Recovery proved partial acceptance, not absence. Keep the original IDs for
        // association checks/withdrawal and bind continuation to the latest consent.
        ledger.repair = { ...ledger.repair, policyVersion: policy.version,
          binding: inspectionBinding({ ...ledger, actual: ledger.repair.original }, context, policy) };
      }
      if (kind === 'upsert' && (ledger.verification?.missing || ledger.repair?.manualReplacement) && (!ledger.repair || !transport.inspection?.policy
        || !canExecuteDeliveryRepair(transport.inspection.policy, ledger.repair)
        || inspectionBinding({ ...ledger, actual: ledger.repair.original }, context, transport.inspection.policy) !== ledger.repair.binding)) {
        // An edit/transfer/reconnect invalidates confirmation, not the stable remote identity.
        // Re-inspect current intent before another repair; never fall through to ordinary upsert.
        if (ledger.repair?.manualReplacement) {
          ledger.status = 'needs_attention';
          ledger.issues = ['The workout or provider authority changed. Check Garmin again and review replacement using the latest version.'];
        }
        ledger.repair = null;
        ledger.verification = { ...emptyVerification(runtime.now()), ...ledger.verification, observedMissingKeys: [], binding: '', state: 'pending', missing: false, missingKeys: [],
          suspectedAtMs: null, checkedAtMs: null, cursor: null, nextCheckAtMs: runtime.now() };
        writeDelivery(runtime, tx, uid, ledger);
        tx.set(jobRef, { uid, kind: 'verification', priority: 'ordinary', deliveryId: id, dueAtMs: 0, dispatchToken: randomUUID() });
        return null;
      }
      ledger.attempt = { id: randomUUID(), kind, deliveryId: id, generation: ledger.desiredGeneration,
        connectionGeneration: context.connection.generation, destinationKey: ledger.destinationKey,
        timeZone: intent.timeZone, digest: intent.digest, contentDigest: ledger.contentDigest,
        workout: kind === 'upsert' ? workout : null,
        ...(kind === 'upsert' && context.strength ? { strength: context.strength } : {}),
        artifact: ledger.actual ?? (kind === 'remove' ? ledger.repair?.original ?? null : null), progress: null,
        ...(kind === 'remove' && context.pastCleanup ? { allowPastRemoval: true } : {}),
        ...(ledger.provider === 'wahoo' ? { wahooPlanGeneration: wahooPlanGeneration(ledger.wahooPlanGeneration === undefined
          ? wahooArtifactGeneration(ledger.actual) : ledger.wahooPlanGeneration) } : {}),
        ...(ledger.repair ? { repair: ledger.repair } : {}) };
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
  const diagnosticMapping = deliveryDiagnosticMapping(claim.provider, transport, operation);
  let diagnosticPhase: DeliveryDiagnosticPhase = claim.recover ? 'recover' : 'execute';
  const diagnosticLabels = () => deliveryDiagnosticLabels(diagnosticMapping, diagnosticPhase);
  const removalLabels = () => claim.provider === 'wahoo' && operation.kind === 'remove'
    && operation.progress?.step === 'finished' && operation.progress.state === 'accepted'
    && operation.progress.removalOutcome === 'already_absent' ? { outcome: 'already_absent' } : {};
  let recoveredAcceptance = false;

  const checkpoint = async (artifact: DeliveryArtifact | null, complete = false,
    progress?: DeliveryTransportProgress | null): Promise<void> => {
    validateArtifact(artifact);
    if (progress !== undefined && progress !== null && (progress.version !== 1
      || !/^[a-z][a-z0-9-]{0,63}$/.test(progress.step)
      || !['ready', 'started', 'rejected', 'accepted'].includes(progress.state)
      || (progress.repairApplied !== undefined && (typeof progress.repairApplied !== 'boolean' || !operation.repair || progress.state !== 'accepted')))) {
      throw new TrainingDeliveryTransportError('uncertain');
    }
    if (progress?.removalOutcome !== undefined && (claim.provider !== 'wahoo' || operation.kind !== 'remove'
      || progress.removalOutcome !== 'already_absent' || progress.state !== 'accepted'
      || !['workout-remove', 'finished'].includes(progress.step))) throw new TrainingDeliveryTransportError('uncertain');
    if (complete && ((operation.kind === 'remove') !== (artifact === null))) {
      // A successful upsert must identify a copy; a successful removal must leave none.
      // Preserve the journal and inspect inconsistent acknowledgements rather than claiming success.
      throw new TrainingDeliveryTransportError('uncertain');
    }
    const observedAbsence = claim.provider === 'wahoo' && operation.kind === 'remove'
      && (progress?.removalOutcome === 'already_absent' || (complete && operation.progress?.removalOutcome === 'already_absent'));
    // Wahoo REMOVE's no-progress artifact checkpoints are protective GET readback
    // (completion/date), not DELETE receipts. DELETEs always use explicit journals.
    const protectiveReadback = claim.provider === 'wahoo' && operation.kind === 'remove'
      && !complete && progress === undefined && artifact !== null;
    const readOnlyRemoval = observedAbsence || protectiveReadback;
    const currentPro = readOnlyRemoval ? await runtime.hasPro(uid) : pro;
    const recorded = await observeDeliveryCheckpoint(claim.provider, complete, progress, () => db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return false;
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return false;
      const ledger = doc.data() as DeliveryLedgerV1;
      // Removal readback did not perform a provider write. A stale observation
      // must neither erase a newer copy nor quarantine its lease/queue as a late
      // write acknowledgement. Only its original live lease may persist it.
      if (readOnlyRemoval && (ledger.attempt?.id !== operation.id || ledger.lease?.id !== leaseId
        || ledger.lease.expiresAtMs <= runtime.now())) return false;
      if (readOnlyRemoval) {
        // Unlike a late HTTP write receipt, read-only observations must still be bound
        // to current authority when persisted, including changes after the last
        // request guard. Recovery may record the old REMOVE while a new Send is
        // pending; execute must still have an authorized absent intent.
        const [workoutDoc, locks] = await Promise.all([
          tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId)),
          tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
        ]);
        const context = await readDeliveryContext(runtime, tx, uid,
          workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null, ledger.provider, currentPro, ledger.workoutId, ledger);
        if (!locks.empty || !context.transport || context.connection.state !== 'connected'
          || context.connection.destinationKey !== operation.destinationKey || context.connection.epoch !== ledger.connectionEpoch
          || context.connection.generation !== operation.connectionGeneration
          || ledger.blockedConnectionGeneration === context.connection.generation
          || (observedAbsence && ledger.actual && !context.transport.canRemove(ledger.actual,
            trainingDeliveryLocalDate(runtime.now(), operation.timeZone), !!context.pastCleanup && !!operation.allowPastRemoval))
          || (observedAbsence && diagnosticPhase === 'execute' && resolveDeliveryIntent(context, ledger).desired !== 'absent')) return false;
        if (protectiveReadback) {
          // A GET may strengthen protection for this exact retained copy. It must
          // not replace another identity or clear completion learned concurrently.
          if (!ledger.actual || !artifact || Object.keys(artifact.ids).length !== Object.keys(ledger.actual.ids).length
            || Object.entries(artifact.ids).some(([key, value]) => ledger.actual!.ids[key] !== value)) return false;
          artifact = { ...artifact, completed: artifact.completed || ledger.actual.completed };
        }
      }
      // Request-start journals must still own the lease. Late acceptance evidence is
      // retained below even after ownership changes, but cannot launch another request.
      if (progress && progress.state !== 'accepted'
        && (ledger.attempt?.id !== operation.id || ledger.lease?.id !== leaseId
          || ledger.lease.expiresAtMs <= runtime.now())) return false;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== leaseId) {
        // A late response must never regress the newer lease's artifact/step journal.
        // Retain its exact evidence independently and block automatic recovery: neither
        // a user Retry nor the other worker may now infer that a POST was unaccepted.
        tx.set(ledgerRef.collection('attempts').doc(operation.id).collection('lateAcceptances').doc(leaseId), {
          artifact, progress: progress ?? operation.progress ?? null, acceptedAtMs: runtime.now(),
        });
        if (!ledger.actual && artifact) ledger.actual = artifact;
        ledger.attempt = { ...(ledger.attempt ?? operation), recoveryBlocked: true };
        ledger.status = 'needs_attention';
        ledger.lease = null;
        ledger.updatedAtMs = runtime.now();
        writeDelivery(runtime, tx, uid, ledger);
        tx.delete(jobRef);
        return false;
      }
      if (complete && claim.provider === 'wahoo' && operation.kind === 'remove'
        && ledger.wahooPlanGeneration !== undefined
        && wahooPlanGeneration(operation.wahooPlanGeneration) !== wahooPlanGeneration(ledger.wahooPlanGeneration)) {
        // A finished REMOVE may have artifact=null already. Validate its durable
        // reservation too, before retiring the journal or advancing the ledger.
        throw new TrainingDeliveryTransportError('uncertain', 0, {
          failurePhase: 'contract', wahooContractCheck: 'operation_invalid',
        });
      }
      // Record acceptance even when a newer authored edit arrived during the HTTP call.
      tx.set(ledgerRef.collection('attempts').doc(operation.id), {
        artifact, state: complete ? 'accepted' : 'checkpoint', checkpointAtMs: runtime.now(),
        ...(complete || !progress || progress.state === 'accepted' ? { acceptedAtMs: runtime.now() } : {}),
        ...(progress === undefined ? {} : { progress }),
      }, { merge: true });
      if (complete || !progress || progress.state === 'accepted') {
        tx.create(ledgerRef.collection('attempts').doc(operation.id).collection('acceptances').doc(randomUUID()), {
          artifact, progress: progress ?? null, acceptedAtMs: runtime.now(),
        });
      }
      ledger.actual = artifact;
      ledger.attempt.artifact = artifact;
      if (progress !== undefined) ledger.attempt.progress = progress;
      if (progress?.state === 'started') {
        // A provider write can invalidate the last fully accepted version even when
        // its response is lost. Reverting to that version must reconcile the retained
        // IDs, not reuse its old success digest after retiring a partial operation.
        ledger.acceptedDigest = null;
        ledger.acceptedContentDigest = null;
      }
      if (complete) {
        if (claim.provider === 'wahoo' && operation.kind === 'remove') {
          // Reserve once, in the same transaction that accepts withdrawal. A
          // future Send must not reuse Wahoo's soft-deleted library Plan key.
          ledger.wahooPlanGeneration = wahooPlanGeneration((operation.wahooPlanGeneration ?? 0) + 1);
        }
        ledger.pastCleanup = null;
        const repairTimes = (ledger.verification?.repairTimes ?? []).filter(time => time > runtime.now() - VERIFICATION_DAY_MS);
        ledger.verification = { ...emptyVerification(runtime.now()),
          requestedAtMs: ledger.verification?.requestedAtMs ?? 0,
          repairTimes: operation.kind === 'upsert' && operation.repair && operation.progress?.repairApplied !== false && (recoveredAcceptance || operation.progress?.state === 'accepted')
            ? [...repairTimes, runtime.now()] : repairTimes };
        ledger.repair = null;
        // A reappearing copy can finish repair without any provider write. Keep
        // Last sent truthful; the inspection projection owns Last checked.
        if (operation.progress?.repairApplied !== false || operation.repair?.continuation) ledger.lastAcceptedAtMs = runtime.now();
        ledger.acceptedDigest = operation.kind === 'upsert' ? operation.digest : null;
        ledger.acceptedContentDigest = operation.kind === 'upsert' ? operation.contentDigest : null;
        ledger.attempt = null;
        ledger.lease = null;
        ledger.retries = 0;
        ledger.retryAtMs = 0;
        ledger.providerNotBeforeMs = 0;
        ledger.status = ledger.desiredDigest === operation.digest ? operation.kind === 'upsert' ? 'delivered' : 'removed' : 'pending';
      }
      ledger.updatedAtMs = runtime.now();
      writeDelivery(runtime, tx, uid, ledger);
      if (complete) {
        tx.delete(jobRef);
        stageTrainingDeliveryReconciliation(tx, db, uid);
      }
      return true;
    }), { mapping: diagnosticMapping, phase: diagnosticPhase });
    if (!recorded) throw new TrainingDeliveryTransportError('retryable');
    operation.artifact = artifact;
    if (progress !== undefined) operation.progress = progress;
  };

  const retireSupersededOperation = async (partial: boolean): Promise<void> => {
    await db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return;
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== leaseId) return;
      ledger.attempt = null;
      ledger.lease = null;
      ledger.status = 'pending';
      if (partial && operation.repair && ledger.actual) {
        ledger.repair = { ...operation.repair, continuation: true };
      }
      tx.set(ledgerRef.collection('attempts').doc(operation.id), { state: partial ? 'superseded' : 'not-accepted' }, { merge: true });
      writeDelivery(runtime, tx, uid, ledger);
      stageTrainingDeliveryReconciliation(tx, db, uid);
    });
  };

  // Recovery can itself take time. Repeat this check after proven nonacceptance,
  // immediately before execute, so a Stop/edit/revocation during inspection wins.
  const checkAdmission = async () => {
    const currentPro = await runtime.hasPro(uid);
    return db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return 'blocked';
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return 'blocked';
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.lease?.id !== leaseId || ledger.lease.expiresAtMs <= runtime.now()
        || ledger.attempt?.id !== operation.id) return 'blocked';
      const [workoutDoc, locks] = await Promise.all([
        tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId)),
        tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
      ]);
      const context = await readDeliveryContext(runtime, tx, uid,
        workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null, ledger.provider, currentPro, ledger.workoutId, ledger);
      if (!locks.empty || !runtime.transport(ledger.provider, uid) || context.connection.state !== 'connected'
        || context.connection.destinationKey !== operation.destinationKey || context.connection.epoch !== ledger.connectionEpoch
        || context.connection.generation !== operation.connectionGeneration
        || ledger.blockedConnectionGeneration === context.connection.generation) return 'blocked';
      const intent = resolveDeliveryIntent(context, ledger);
      if (operation.kind === 'upsert' && operation.repair && (!context.transport?.inspection?.policy
        || !canExecuteDeliveryRepair(context.transport.inspection.policy, operation.repair)
        || inspectionBinding({ ...ledger, actual: operation.repair.original, desiredDigest: operation.digest },
          context, context.transport.inspection.policy) !== operation.repair.binding)) return 'recover-only';
      return (operation.kind === 'upsert' && intent.desired === 'present' && intent.digest === operation.digest)
        || (operation.kind === 'remove' && intent.desired === 'absent') ? 'execute' : 'recover-only';
    });
  };
  const transportCheckpoint = (artifact: DeliveryArtifact | null, progress?: DeliveryTransportProgress | null) => checkpoint(artifact, false, progress);
  const requestGuard = async (mutating: boolean): Promise<void> => {
    const admission = await checkAdmission();
    if (admission === 'blocked' || (mutating && admission !== 'execute')) throw new TrainingDeliveryTransportError('retryable');
  };
  let inspectionUncertain = false;
  let partial = false;
  try {
    let admission = await checkAdmission();
    if (admission === 'blocked') return; // Lease expiry + dispatcher resumes after valid access; keep operation journal.
    if (claim.recover) {
      if (operation.recoveryBlocked) { inspectionUncertain = true; throw new TrainingDeliveryTransportError('uncertain'); }
      const recovery = await transport.recover(operation, transportCheckpoint, requestGuard);
      if (recovery.kind === 'accepted') {
        recoveredAcceptance = true;
        await checkpoint(recovery.artifact, true);
        logger.info('[TrainingDelivery]', { event: 'recovered_acceptance', provider: claim.provider, repair: !!operation.repair,
          ...removalLabels(), ...diagnosticLabels() });
        return;
      }
      if (recovery.kind === 'uncertain') { inspectionUncertain = true; throw new TrainingDeliveryTransportError('uncertain'); }
      partial = recovery.kind === 'resume';
      admission = await checkAdmission();
      if (admission === 'blocked') return;
    }
    if (admission === 'recover-only') {
      await retireSupersededOperation(partial);
      logger.info('[TrainingDelivery]', { event: 'stale_suppressed', provider: claim.provider, ...diagnosticLabels() });
      return;
    }
    diagnosticPhase = 'execute';
    const artifact = await transport.execute(operation, transportCheckpoint, requestGuard);
    await checkpoint(artifact, true);
    logger.info('[TrainingDelivery]', { event: operation.repair ? 'repair_accepted' : 'accepted', provider: claim.provider, operation: operation.kind,
      ...removalLabels(),
      latencyMs: runtime.now() - startedAt, ...diagnosticLabels() });
  } catch (error) {
    const failure = error instanceof TrainingDeliveryTransportError ? error : new TrainingDeliveryTransportError('uncertain');
    if (operation.repair?.manualReplacement && failure.kind === 'uncertain') inspectionUncertain = true;
    let retryCount = 0;
    await db.runTransaction(async tx => {
      if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
      const doc = await tx.get(ledgerRef);
      if (!doc.exists) return;
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== leaseId) return;
      ledger.lease = null;
      if (failure.kind !== 'deferred') ledger.retries += 1;
      retryCount = ledger.retries;
      ledger.status = failure.kind === 'deferred' ? 'retrying' : failure.kind === 'auth' ? 'reconnect_required' : failure.kind === 'permission' ? 'connection_repair'
        : failure.kind === 'provider_access' ? 'provider_unavailable'
        : failure.kind === 'uncertain' ? inspectionUncertain || failure.diagnostics.wahooContractCheck === 'plan_deleted'
          || ledger.retries >= MAX_RETRY_COUNT ? 'needs_attention' : 'retrying'
          : failure.kind === 'terminal' || ledger.retries >= MAX_RETRY_COUNT ? 'failed' : 'retrying';
      ledger.blockedConnectionGeneration = ['auth', 'permission'].includes(failure.kind) ? operation.connectionGeneration : null;
      ledger.providerAccessBlocked = failure.kind === 'provider_access';
      if (failure.kind === 'permission') ledger.issues = ['Workout delivery permission is missing. Reconnect the provider and allow workout delivery.'];
      if (failure.kind === 'provider_access') ledger.issues = ['The provider has not allowed this application to deliver workouts. Reconnecting may not resolve this.'];
      if (failure.diagnostics.wahooContractCheck === 'plan_deleted') ledger.issues = [
        'Wahoo reports this plan deleted. Safe withdrawal has not been confirmed, so QS will not recreate or retry the copy automatically.',
      ];
      ledger.providerNotBeforeMs = Math.max(ledger.providerNotBeforeMs ?? 0,
        failure.retryAfterMs > 0 ? runtime.now() + failure.retryAfterMs : 0);
      ledger.retryAtMs = Math.max(runtime.now() + getCloudTaskRetryBackoffSeconds(ledger.retries) * 1000, ledger.providerNotBeforeMs);
      ledger.updatedAtMs = runtime.now();
      if (operation.repair && ledger.verification) ledger.verification.state = failure.kind === 'deferred' ? 'deferred'
        : operation.repair.manualReplacement ? 'unknown' : 'confirmed_missing';
      writeDelivery(runtime, tx, uid, ledger);
      if (ledger.status === 'retrying') tx.set(jobRef, { uid, kind: 'delivery', deliveryId: id,
        provider: ledger.provider, destinationKey: ledger.destinationKey, operationKind: operation.kind,
        dueAtMs: ledger.retryAtMs, dispatchToken: randomUUID() });
      else tx.delete(jobRef);
    });
    logger.warn('[TrainingDelivery]', { event: 'failure', provider: claim.provider, category: failure.kind, ...failure.diagnostics,
      retryCount, latencyMs: runtime.now() - startedAt, ...diagnosticLabels() });
  }
}
