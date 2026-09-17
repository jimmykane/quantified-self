import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1, type PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { getCloudTaskRetryBackoffSeconds, MAX_RETRY_COUNT } from '../../shared/queue-config';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { DELIVERY_LEDGER, DELIVERY_LEASE_MS, DELIVERY_QUEUE, DELIVERY_STATE,
  TrainingDeliveryBatchAdmissionChangedError, TrainingDeliveryBatchError, TrainingDeliveryTransportError,
  type DeliveryBatchOutcome, type DeliveryLedgerV1, type DeliveryOperation, type DeliveryRuntime,
  type DeliveryTransportProgress, type TrainingDeliveryTransport } from './contracts';
import { deliveryContentDigest, resolveDeliveryIntent } from './intent';
import { stageTrainingDeliveryReconciliation } from './marker';
import { queuedDeliveryOperation, readDeliveryContext, writeDelivery } from './store';

const BATCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface BatchClaim {
  batchId: string;
  leaseId: string;
  provider: PlannedWorkoutProviderId;
  destinationKey: string;
  operationKind: 'upsert' | 'remove';
  transport: TrainingDeliveryTransport;
  operations: DeliveryOperation[];
}

function batchRef(runtime: DeliveryRuntime, uid: string, batchId: string) {
  return runtime.db.collection('users').doc(uid).collection(DELIVERY_STATE).doc('current').collection('batches').doc(batchId);
}

function queueMetadata(record: DeliveryLedgerV1, operationKind: 'upsert' | 'remove') {
  return { kind: 'delivery', deliveryId: record.id, provider: record.provider,
    destinationKey: record.destinationKey, operationKind };
}

function isSameBatchTransport(
  candidate: TrainingDeliveryTransport | null,
  expected: TrainingDeliveryTransport,
): boolean {
  // Production runtimes may return freshly bound wrapper objects on each
  // authority read. Compare the immutable adapter contract instead of JS
  // object identity, which would reject an otherwise valid provider batch.
  return !!candidate?.batch
    && candidate.mappingVersion === expected.mappingVersion
    && candidate.batch.maxSize === expected.batch?.maxSize;
}

async function claimBatch(runtime: DeliveryRuntime, uid: string, seedId: string,
  provider: PlannedWorkoutProviderId, transport: TrainingDeliveryTransport): Promise<BatchClaim | null> {
  const { db } = runtime;
  const now = runtime.now();
  const pro = await runtime.hasPro(uid);
  const seed = await db.collection(DELIVERY_QUEUE).doc(seedId).get();
  const seedData = seed.data();
  if (!seed.exists || seedData?.uid !== uid || seedData.deliveryId !== seedId || seedData.provider !== provider
    || typeof seedData.destinationKey !== 'string' || !['upsert', 'remove'].includes(seedData.operationKind)
    || !transport.batch) return null;
  const batchTransport = transport.batch;
  if (!Number.isInteger(batchTransport.maxSize) || batchTransport.maxSize < 1 || batchTransport.maxSize > 30) return null;
  const destinationKey = seedData.destinationKey as string;
  const operationKind = seedData.operationKind as 'upsert' | 'remove';
  const batchId = randomUUID();
  const leaseId = randomUUID();
  const user = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return null;
    const [currentSeed, siblings, locks] = await Promise.all([
      tx.get(db.collection(DELIVERY_QUEUE).doc(seedId)),
      tx.get(db.collection(DELIVERY_QUEUE)
        .where('kind', '==', 'delivery').where('uid', '==', uid).where('provider', '==', provider)
        .where('destinationKey', '==', destinationKey).where('operationKind', '==', operationKind)
        .where('dueAtMs', '<=', now).orderBy('dueAtMs').limit(batchTransport.maxSize)),
      tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
    ]);
    if (!currentSeed.exists || !locks.empty) return null;
    const jobDocs = [currentSeed, ...siblings.docs.filter(doc => doc.id !== seedId)].slice(0, batchTransport.maxSize);
    const prepared: Array<{ ledger: DeliveryLedgerV1; operation: Omit<DeliveryOperation, 'providerIdentity' | 'batchId'> }> = [];
    const deferredWrites: Array<() => void> = [];
    const abandonedBatchIds = new Set<string>();
    let batchTimeZone: string | null = null;

    for (const job of jobDocs) {
      const jobData = job.data();
      if (!jobData) continue;
      if (jobData.deliveryId !== job.id || jobData.uid !== uid || jobData.provider !== provider || jobData.destinationKey !== destinationKey
        || jobData.operationKind !== operationKind) continue;
      const ledgerRef = user.collection(DELIVERY_LEDGER).doc(jobData.deliveryId);
      const ledgerDoc = await tx.get(ledgerRef);
      if (!ledgerDoc.exists) { deferredWrites.push(() => tx.delete(job.ref)); continue; }
      const ledger = ledgerDoc.data() as DeliveryLedgerV1;
      if (ledger.provider !== provider || ledger.destinationKey !== destinationKey
        || ledger.retryAtMs > now || (ledger.lease && ledger.lease.expiresAtMs > now)
        || ledger.providerAccessBlocked || ['failed', 'needs_attention'].includes(ledger.status)) continue;
      if (ledger.attempt) {
        if (ledger.attempt.batchId && ledger.attempt.progress === null) {
          // `progress: null` is the durable proof that no provider request began.
          // Recover a crash after claim/journal creation without asking the user
          // to review an operation that never left QS.
          const abandonedAttemptId = ledger.attempt.id;
          if (typeof ledger.attempt.batchId === 'string' && BATCH_ID_PATTERN.test(ledger.attempt.batchId)) {
            abandonedBatchIds.add(ledger.attempt.batchId);
          }
          ledger.attempt = null; ledger.lease = null;
          deferredWrites.push(() => tx.set(ledgerRef.collection('attempts').doc(abandonedAttemptId), {
            state: 'superseded', reason: 'request_not_started', completedAtMs: runtime.now(),
          }, { merge: true }));
        } else {
          deferredWrites.push(() => {
            ledger.status = 'needs_attention'; ledger.lease = null; ledger.updatedAtMs = runtime.now();
            ledger.issues = ['A previous batch may have been accepted. Review before retrying.'];
            writeDelivery(runtime, tx, uid, ledger); tx.delete(job.ref);
          });
          continue;
        }
      }
      const workoutDoc = await tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId));
      const workout = workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null;
      const context = await readDeliveryContext(runtime, tx, uid, workout, provider, pro, ledger.workoutId);
      const intent = resolveDeliveryIntent(context, ledger);
      if (context.connection.state !== 'connected' || context.connection.destinationKey !== destinationKey
        || ledger.connectionEpoch !== context.connection.epoch || !isSameBatchTransport(context.transport, transport)
        || ledger.blockedConnectionGeneration === context.connection.generation) {
        deferredWrites.push(() => {
          ledger.status = intent.status; ledger.issues = intent.issues; ledger.lease = null;
          writeDelivery(runtime, tx, uid, ledger); tx.delete(job.ref);
        });
        continue;
      }
      const changed = ledger.desiredDigest !== intent.digest || ledger.desired !== intent.desired;
      ledger.desiredGeneration += changed ? 1 : 0;
      ledger.desiredDigest = intent.digest; ledger.desired = intent.desired; ledger.status = intent.status;
      ledger.issues = intent.issues; ledger.approvalDigest = intent.approvalDigest; ledger.timeZone = intent.timeZone;
      ledger.contentDigest = deliveryContentDigest(workout, intent.timeZone);
      const kind = queuedDeliveryOperation(ledger);
      if (!kind) {
        deferredWrites.push(() => { writeDelivery(runtime, tx, uid, ledger); tx.delete(job.ref); });
        continue;
      }
      if (kind !== operationKind) {
        deferredWrites.push(() => {
          writeDelivery(runtime, tx, uid, ledger);
          tx.set(job.ref, { ...queueMetadata(ledger, kind), uid, dueAtMs: 0,
            dispatchToken: randomUUID() }, { merge: true });
        });
        continue;
      }
      // A provider request has one scheduling calendar. Workouts with another
      // saved zone remain queued for a later batch instead of invalidating all
      // otherwise eligible members of this one.
      if (batchTimeZone !== null && intent.timeZone !== batchTimeZone) {
        // Persist refreshed intent and, critically, removal of an expired
        // prepared attempt even though this workout belongs in another batch.
        // Its queue leaf stays due so the next worker can claim that zone.
        deferredWrites.push(() => writeDelivery(runtime, tx, uid, ledger));
        continue;
      }
      batchTimeZone = intent.timeZone;
      prepared.push({ ledger, operation: { id: randomUUID(), kind, deliveryId: ledger.id,
        generation: ledger.desiredGeneration, connectionGeneration: context.connection.generation,
        destinationKey, timeZone: intent.timeZone, digest: intent.digest, contentDigest: ledger.contentDigest,
        workout: kind === 'upsert' ? workout : null, artifact: ledger.actual, progress: null } });
    }

    const abandonedBatches = await Promise.all([...abandonedBatchIds]
      .map(id => tx.get(batchRef(runtime, uid, id))));
    const identities = prepared.length
      ? await batchTransport.reserveIdentities(db, tx, uid, destinationKey, prepared.map(item => item.ledger.workoutId)) : null;
    for (const write of deferredWrites) write();
    for (const batch of abandonedBatches) {
      if (batch.exists) tx.set(batch.ref, { state: 'superseded', reason: 'request_not_started',
        completedAtMs: runtime.now(), updatedAtMs: runtime.now() }, { merge: true });
    }
    if (!identities || prepared.length === 0) return null;

    const operations: DeliveryOperation[] = [];
    for (const item of prepared) {
      const operation: DeliveryOperation = { ...item.operation, batchId,
        providerIdentity: identities.get(item.ledger.workoutId) };
      if (!operation.providerIdentity) throw new TrainingDeliveryTransportError('uncertain');
      item.ledger.attempt = operation;
      item.ledger.lease = { id: leaseId, expiresAtMs: runtime.now() + DELIVERY_LEASE_MS };
      item.ledger.lastAttemptAtMs = runtime.now(); item.ledger.updatedAtMs = runtime.now();
      writeDelivery(runtime, tx, uid, item.ledger);
      tx.create(user.collection(DELIVERY_LEDGER).doc(item.ledger.id).collection('attempts').doc(operation.id), {
        schemaVersion: 1, batchId, operation, state: 'prepared', startedAtMs: runtime.now(),
      });
      tx.set(db.collection(DELIVERY_QUEUE).doc(item.ledger.id), {
        ...queueMetadata(item.ledger, operationKind), uid, dueAtMs: item.ledger.lease.expiresAtMs,
      }, { merge: true });
      operations.push(operation);
    }
    tx.create(batchRef(runtime, uid, batchId), { schemaVersion: 1, provider, destinationKey,
      operationKind, state: 'prepared', operationIds: operations.map(operation => operation.id),
      deliveryIds: operations.map(operation => operation.deliveryId), createdAtMs: runtime.now(), updatedAtMs: runtime.now() });
    return { batchId, leaseId, provider, destinationKey, operationKind, transport, operations };
  });
}

async function batchAdmission(runtime: DeliveryRuntime, uid: string, claim: BatchClaim): Promise<boolean> {
  const pro = await runtime.hasPro(uid);
  const { db } = runtime;
  const user = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return false;
    const locks = await tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1));
    if (!locks.empty) return false;
    for (const operation of claim.operations) {
      const ledgerDoc = await tx.get(user.collection(DELIVERY_LEDGER).doc(operation.deliveryId));
      if (!ledgerDoc.exists) return false;
      const ledger = ledgerDoc.data() as DeliveryLedgerV1;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== claim.leaseId
        || ledger.lease.expiresAtMs <= runtime.now()) return false;
      const workoutDoc = await tx.get(user.collection('scheduledWorkouts').doc(ledger.workoutId));
      const context = await readDeliveryContext(runtime, tx, uid,
        workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null, claim.provider, pro, ledger.workoutId);
      const intent = resolveDeliveryIntent(context, ledger);
      if (!isSameBatchTransport(context.transport, claim.transport) || context.connection.state !== 'connected'
        || context.connection.destinationKey !== operation.destinationKey
        || context.connection.generation !== operation.connectionGeneration
        || context.connection.epoch !== ledger.connectionEpoch
        || ledger.blockedConnectionGeneration === operation.connectionGeneration
        || !((operation.kind === 'upsert' && intent.desired === 'present' && intent.digest === operation.digest)
          || (operation.kind === 'remove' && intent.desired === 'absent'))) return false;
    }
    return true;
  });
}

async function markBatchStarted(runtime: DeliveryRuntime, uid: string, claim: BatchClaim): Promise<void> {
  if (!await batchAdmission(runtime, uid, claim)) throw new TrainingDeliveryBatchAdmissionChangedError();
  const { db } = runtime;
  const user = db.collection('users').doc(uid);
  await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) throw new TrainingDeliveryBatchAdmissionChangedError();
    const documents = await Promise.all(claim.operations.map(operation =>
      tx.get(user.collection(DELIVERY_LEDGER).doc(operation.deliveryId))));
    for (let index = 0; index < claim.operations.length; index++) {
      const operation = claim.operations[index];
      const doc = documents[index];
      const ref = doc.ref;
      const ledger = doc.data() as DeliveryLedgerV1 | undefined;
      if (!doc.exists || ledger?.attempt?.id !== operation.id || ledger.lease?.id !== claim.leaseId
        || ledger.lease.expiresAtMs <= runtime.now()) throw new TrainingDeliveryBatchAdmissionChangedError();
      const progress: DeliveryTransportProgress = { version: 1, step: `batch-${claim.operationKind}`, state: 'started' };
      ledger.attempt.progress = progress; operation.progress = progress; ledger.updatedAtMs = runtime.now();
      writeDelivery(runtime, tx, uid, ledger);
      tx.set(ref.collection('attempts').doc(operation.id), { state: 'started', progress, requestStartedAtMs: runtime.now() }, { merge: true });
    }
    tx.set(batchRef(runtime, uid, claim.batchId), { state: 'started', requestStartedAtMs: runtime.now(), updatedAtMs: runtime.now() }, { merge: true });
  });
  // A Stop/edit/account change committed after the start journal but before the
  // HTTP call must still win. The client treats this callback failure as rejected.
  if (!await batchAdmission(runtime, uid, claim)) throw new TrainingDeliveryBatchAdmissionChangedError();
}

function isValidArtifact(value: DeliveryBatchOutcome['artifact']): boolean {
  return value !== null
    && /^\d{4}-\d{2}-\d{2}$/.test(value.localDate)
    && typeof value.completed === 'boolean'
    && !!value.ids
    && !Array.isArray(value.ids)
    && Object.keys(value.ids).length >= 1
    && Object.keys(value.ids).length <= 16
    && Object.entries(value.ids).every(([key, id]) =>
      /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) && typeof id === 'string' && id.length >= 1 && id.length <= 512);
}

function validateOutcomes(claim: BatchClaim, outcomes: readonly DeliveryBatchOutcome[]): Map<string, DeliveryBatchOutcome> {
  if (outcomes.length !== claim.operations.length) throw new TrainingDeliveryTransportError('uncertain');
  const byOperation = new Map<string, DeliveryBatchOutcome>();
  for (const outcome of outcomes) {
    const operation = claim.operations.find(candidate => candidate.id === outcome.operationId);
    if (!operation || byOperation.has(outcome.operationId)
      || !['accepted', 'rejected', 'unresolved'].includes(outcome.state)
      || (outcome.artifact !== null && !isValidArtifact(outcome.artifact))
      || (outcome.state === 'accepted' && operation.kind === 'upsert' && !isValidArtifact(outcome.artifact))
      || (outcome.state === 'accepted' && operation.kind === 'remove' && outcome.artifact !== null)) {
      throw new TrainingDeliveryTransportError('uncertain');
    }
    byOperation.set(outcome.operationId, outcome);
  }
  return byOperation;
}

async function acceptBatch(runtime: DeliveryRuntime, uid: string, claim: BatchClaim,
  outcomes: readonly DeliveryBatchOutcome[]): Promise<void> {
  const byOperation = validateOutcomes(claim, outcomes);
  const providerLabel = PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[claim.provider].label;
  const { db } = runtime;
  const user = db.collection('users').doc(uid);
  await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
    const accepted: string[] = []; const rejected: string[] = []; const unresolved: string[] = [];
    const documents = await Promise.all(claim.operations.map(operation =>
      tx.get(user.collection(DELIVERY_LEDGER).doc(operation.deliveryId))));
    for (let index = 0; index < claim.operations.length; index++) {
      const operation = claim.operations[index];
      const outcome = byOperation.get(operation.id)!;
      const doc = documents[index];
      const ref = doc.ref;
      if (!doc.exists) continue;
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== claim.leaseId) {
        const stillSameAttempt = ledger.attempt?.id === operation.id;
        tx.set(ref.collection('attempts').doc(operation.id).collection('lateAcceptances').doc(claim.batchId), {
          batchId: claim.batchId, outcome, acceptedAtMs: runtime.now(),
        });
        // A newer attempt owns the ledger and queue. Preserve its state exactly;
        // the immutable late evidence is sufficient for operator inspection.
        // If only the lease changed, this is still the current attempt and its
        // accepted artifact must be retained conservatively.
        if (stillSameAttempt) {
          if (outcome.state === 'accepted') ledger.actual = outcome.artifact;
          ledger.status = 'needs_attention'; ledger.updatedAtMs = runtime.now();
          ledger.issues = [`${providerLabel} responded after delivery ownership changed. Review before retrying.`];
          writeDelivery(runtime, tx, uid, ledger);
          tx.delete(db.collection(DELIVERY_QUEUE).doc(operation.deliveryId));
        }
        unresolved.push(operation.deliveryId);
        continue;
      }
      ledger.lease = null; ledger.updatedAtMs = runtime.now();
      if (outcome.state === 'accepted') {
        ledger.actual = outcome.artifact;
        ledger.acceptedDigest = operation.kind === 'upsert' ? operation.digest : null;
        ledger.acceptedContentDigest = operation.kind === 'upsert' ? operation.contentDigest : null;
        ledger.lastAcceptedAtMs = runtime.now(); ledger.attempt = null; ledger.retries = 0;
        ledger.retryAtMs = 0; ledger.providerNotBeforeMs = 0;
        ledger.status = ledger.desiredDigest === operation.digest
          ? operation.kind === 'upsert' ? 'delivered' : 'removed' : 'pending';
        accepted.push(operation.deliveryId);
      } else if (outcome.state === 'rejected') {
        ledger.attempt = null; ledger.status = 'failed';
        ledger.issues = [operation.kind === 'remove'
          ? `${providerLabel} could not remove this future workout.`
          : `${providerLabel} could not accept this workout.`];
        rejected.push(operation.deliveryId);
      } else {
        ledger.status = 'needs_attention';
        ledger.issues = [`${providerLabel} returned an incomplete or conflicting batch result. Review before retrying.`];
        unresolved.push(operation.deliveryId);
      }
      writeDelivery(runtime, tx, uid, ledger);
      tx.set(ref.collection('attempts').doc(operation.id), { state: outcome.state, outcome,
        completedAtMs: runtime.now() }, { merge: true });
      tx.delete(db.collection(DELIVERY_QUEUE).doc(operation.deliveryId));
    }
    const batchState = unresolved.length ? 'needs_attention'
      : rejected.length === claim.operations.length ? 'rejected'
        : rejected.length ? 'partially_rejected' : 'accepted';
    tx.set(batchRef(runtime, uid, claim.batchId), { state: batchState,
      acceptedDeliveryIds: accepted, rejectedDeliveryIds: rejected, unresolvedDeliveryIds: unresolved,
      completedAtMs: runtime.now(), updatedAtMs: runtime.now() }, { merge: true });
    stageTrainingDeliveryReconciliation(tx, db, uid);
  });
}

async function rejectBatch(runtime: DeliveryRuntime, uid: string, claim: BatchClaim, error: unknown): Promise<void> {
  const failure = error instanceof TrainingDeliveryTransportError ? error : new TrainingDeliveryTransportError('uncertain');
  const rejected = error instanceof TrainingDeliveryBatchError && error.rejected;
  const admissionChanged = error instanceof TrainingDeliveryBatchAdmissionChangedError;
  const providerLabel = PLANNED_WORKOUT_PROVIDER_CAPABILITIES_V1[claim.provider].label;
  const { db } = runtime;
  const user = db.collection('users').doc(uid);
  await db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return;
    const documents = await Promise.all(claim.operations.map(operation =>
      tx.get(user.collection(DELIVERY_LEDGER).doc(operation.deliveryId))));
    for (let index = 0; index < claim.operations.length; index++) {
      const operation = claim.operations[index];
      const doc = documents[index];
      const ref = doc.ref;
      if (!doc.exists) continue;
      const ledger = doc.data() as DeliveryLedgerV1;
      if (ledger.attempt?.id !== operation.id || ledger.lease?.id !== claim.leaseId) continue;
      ledger.lease = null; ledger.updatedAtMs = runtime.now();
      if (admissionChanged) {
        ledger.attempt = null;
        ledger.status = 'pending';
        ledger.issues = [];
        tx.delete(db.collection(DELIVERY_QUEUE).doc(operation.deliveryId));
      } else if (!rejected || failure.kind === 'uncertain') {
        ledger.status = 'needs_attention';
        ledger.issues = [`The ${providerLabel} batch outcome could not be confirmed. Retry will not resend it automatically.`];
        tx.delete(db.collection(DELIVERY_QUEUE).doc(operation.deliveryId));
      } else {
        ledger.attempt = null;
        if (failure.kind !== 'deferred') ledger.retries += 1;
        if (failure.kind === 'auth') {
          ledger.status = 'reconnect_required'; ledger.blockedConnectionGeneration = operation.connectionGeneration;
          ledger.issues = [`Reconnect ${providerLabel} before sending workouts.`];
        } else if (failure.kind === 'provider_access' || failure.kind === 'permission') {
          ledger.status = 'provider_unavailable';
          ledger.providerAccessBlocked = true;
          ledger.issues = [`${providerLabel} workout delivery is not enabled for Quantified Self.`];
        } else if (failure.kind === 'terminal' || ledger.retries >= MAX_RETRY_COUNT) {
          ledger.status = 'failed'; ledger.issues = [`${providerLabel} rejected this workout batch.`];
        } else {
          ledger.status = 'retrying';
          ledger.providerNotBeforeMs = Math.max(ledger.providerNotBeforeMs ?? 0,
            failure.retryAfterMs > 0 ? runtime.now() + failure.retryAfterMs : 0);
          ledger.retryAtMs = Math.max(runtime.now() + getCloudTaskRetryBackoffSeconds(ledger.retries) * 1000,
            ledger.providerNotBeforeMs ?? 0);
          tx.set(db.collection(DELIVERY_QUEUE).doc(operation.deliveryId), {
            ...queueMetadata(ledger, operation.kind), uid, dueAtMs: ledger.retryAtMs, dispatchToken: randomUUID(),
          });
        }
        if (ledger.status !== 'retrying') tx.delete(db.collection(DELIVERY_QUEUE).doc(operation.deliveryId));
      }
      writeDelivery(runtime, tx, uid, ledger);
      tx.set(ref.collection('attempts').doc(operation.id), { state: admissionChanged ? 'superseded' : rejected ? 'rejected' : 'uncertain',
        failureKind: failure.kind, completedAtMs: runtime.now() }, { merge: true });
    }
    tx.set(batchRef(runtime, uid, claim.batchId), { state: admissionChanged ? 'superseded' : rejected ? 'rejected' : 'needs_attention',
      failureKind: failure.kind, completedAtMs: runtime.now(), updatedAtMs: runtime.now() }, { merge: true });
    if (admissionChanged) stageTrainingDeliveryReconciliation(tx, db, uid);
  });
  logger.warn('[TrainingDelivery]', { event: 'batch_failure', provider: claim.provider,
    category: failure.kind, batchSize: claim.operations.length, ...failure.diagnostics });
}

/** Optional provider-neutral batch path. Identity reservation and response
 * interpretation stay behind the adapter boundary; single-item transports are unchanged. */
export async function processTrainingDeliveryBatch(runtime: DeliveryRuntime, uid: string, id: string,
  provider: PlannedWorkoutProviderId, transport: TrainingDeliveryTransport): Promise<void> {
  if (!transport.batch) return;
  const claim = await claimBatch(runtime, uid, id, provider, transport);
  if (!claim) return;
  try {
    const outcomes = await transport.batch.execute(claim.operations,
      () => markBatchStarted(runtime, uid, claim), async mutating => {
        if (mutating && !await batchAdmission(runtime, uid, claim)) throw new TrainingDeliveryBatchAdmissionChangedError();
      });
    await acceptBatch(runtime, uid, claim, outcomes);
    logger.info('[TrainingDelivery]', { event: 'batch_accepted', provider: claim.provider,
      operation: claim.operationKind, batchSize: claim.operations.length });
  } catch (error) {
    await rejectBatch(runtime, uid, claim, error);
  }
}
