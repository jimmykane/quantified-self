import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import { ActivityTypes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '../../../../shared/unit-aware-display';
import { normalizeSuuntoSwimmingGuideSettings, type SuuntoSwimmingGuideSettings } from '../../../../shared/suunto-swimming-guide-settings';
import { isSuuntoSwimmingSport } from '../providers/suunto-swimming-presentation';
import {
  STRENGTH_DETAILS_COLLECTION_ID, STRENGTH_DETAILS_DOCUMENT_ID,
  isStrengthWorkoutSportV1, parseStrengthWorkoutDetailsV1, strengthProjectionMatchesDetails,
  type StrengthWorkoutDetailsV1,
} from '../../../../shared/strength-workout';
import { PLANNED_WORKOUT_PROVIDER_IDS, type PlannedWorkoutProviderId } from '../../../../shared/planned-workout-providers';
import { parseScheduledWorkoutV1, type ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { deliverySettingsId, TRAINING_DELIVERY_PAGE_SIZE, TRAINING_DELIVERY_SETTINGS, TRAINING_DELIVERY_STATUSES,
  type TrainingDeliverySettingsV1, type TrainingDeliveryStatusV1 } from '../../../../shared/training-provider-delivery';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { DELIVERY_LEDGER, DELIVERY_QUEUE, DELIVERY_SCOPES, DELIVERY_STATE,
  type DeliveryContext, type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { deliveryContentDigest, deliveryIdentity, resolveDeliveryIntent } from './intent';
import { reconciliationJobId, reconciliationTargets } from './marker';
import { TRAINING_DELIVERY_VERIFICATIONS, type TrainingVerificationV1 } from '../../../../shared/training-provider-verification';
import { readVerificationRequest, stageVerification } from './verification-queue';
import { TrainingScheduleMutationError } from '../mutation';
import { readPastCleanupAuthorization } from './marker';
import { ReconciliationReads, type DeliveryDocumentReader } from './reconciliation-reads';
import { claimTrainingReconciliation, globalReconciliationGeneration, nextTrainingLocalDay,
  RECONCILIATION_REPAIR_MS, releaseFailedTrainingReconciliation } from './reconciliation-coordinator';

export async function readStrengthDetailsForDelivery(tx: DeliveryDocumentReader,
  user: FirebaseFirestore.DocumentReference, workout: ScheduledWorkoutV1): Promise<StrengthWorkoutDetailsV1 | null> {
  if (!isStrengthWorkoutSportV1(workout.structure.sport)) return null;
  const snapshot = await tx.get(user.collection('scheduledWorkouts').doc(workout.id)
    .collection(STRENGTH_DETAILS_COLLECTION_ID).doc(STRENGTH_DETAILS_DOCUMENT_ID));
  if (!snapshot.exists) {
    if (workout.structure.sport === ActivityTypes.StrengthTraining) throw new TrainingScheduleMutationError('failed-precondition', 'Strength prescription is missing.');
    return null;
  }
  const details = parseStrengthWorkoutDetailsV1(snapshot.data());
  if (details.workoutId !== workout.id || !strengthProjectionMatchesDetails(workout.structure, details)) {
    throw new TrainingScheduleMutationError('failed-precondition', 'Strength prescription and summary do not match.');
  }
  return details;
}

/** Suunto's app preview uses owner units; native watch measurements remain canonical. */
export async function readSuuntoGuideUnitSettings(tx: DeliveryDocumentReader, user: FirebaseFirestore.DocumentReference,
  provider: PlannedWorkoutProviderId, workouts: readonly ScheduledWorkoutV1[]): Promise<UserUnitSettingsInterface | undefined> {
  return (await readSuuntoGuideOwnerPreferences(tx, user, provider, workouts)).unitSettings;
}
export async function readSuuntoGuideOwnerPreferences(tx: DeliveryDocumentReader, user: FirebaseFirestore.DocumentReference,
  provider: PlannedWorkoutProviderId, workouts: readonly ScheduledWorkoutV1[]): Promise<{
    unitSettings?: UserUnitSettingsInterface; swimmingSettings?: SuuntoSwimmingGuideSettings;
  }> {
  if (provider !== 'suunto' || !workouts.length) return {};
  const owner = await tx.get(user);
  const units = normalizeUserUnitSettings(owner.get('settings.unitSettings'));
  // Settings are owner-writable; duplicate valid enum entries must not inflate
  // every operation/proof snapshot or the per-workout conversion work.
  // First-occurrence order is unchanged, so display priority stays identical.
  const unitSettings = { ...units, speedUnits: [...new Set(units.speedUnits)], paceUnits: [...new Set(units.paceUnits)],
    swimPaceUnits: [...new Set(units.swimPaceUnits)], verticalSpeedUnits: [...new Set(units.verticalSpeedUnits)],
    gradeAdjustedSpeedUnits: [...new Set(units.gradeAdjustedSpeedUnits)],
    gradeAdjustedPaceUnits: [...new Set(units.gradeAdjustedPaceUnits)] };
  // AppUserService writes display preferences to the owner config document,
  // not the legacy root settings. Keep the frozen unit source unchanged so
  // older in-flight mappings still reproduce their exact content digest.
  if (!workouts.some(workout => workout.structure && isSuuntoSwimmingSport(workout.structure.sport))) return { unitSettings };
  const config = await tx.get(user.collection('config').doc('settings'));
  return { unitSettings, swimmingSettings: normalizeSuuntoSwimmingGuideSettings(config.get('suuntoSwimmingGuide')) };
}

export async function readDeliveryContext(runtime: DeliveryRuntime, tx: Transaction, uid: string,
  workout: ScheduledWorkoutV1 | null, provider: PlannedWorkoutProviderId, hasPro: boolean,
  retainedWorkoutId?: string, ledger?: DeliveryLedgerV1 | null, reads?: ReconciliationReads): Promise<DeliveryContext> {
  const user = runtime.db.collection('users').doc(uid);
  const reader = reads ?? tx;
  const connection = await (reads ? reads.connection(provider) : runtime.connection(tx, uid, provider));
  const strength = workout ? await readStrengthDetailsForDelivery(reader, user, workout) : null;
  const preferences = await readSuuntoGuideOwnerPreferences(reader, user, provider, workout ? [workout] : []);
  const suuntoUnitSettings = preferences.unitSettings;
  const suuntoWeightUnits = strength ? suuntoUnitSettings?.weightUnits : undefined;
  const workoutId = workout?.id ?? retainedWorkoutId;
  const [overrideDoc, settingDoc, scopeDoc, planDoc] = workoutId ? await Promise.all([
    reader.get(user.collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId('workout', workoutId, provider))),
    workout?.planId ? reader.get(user.collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId('plan', workout.planId, provider))) : null,
    reader.get(user.collection(DELIVERY_SCOPES).doc(workoutId)),
    workout?.planId ? reader.get(user.collection('trainingPlans').doc(workout.planId)) : null,
  ]) : [null, null, null, null];
  const override = (overrideDoc?.data() ?? null) as TrainingDeliverySettingsV1 | null;
  const pastCleanup = ledger ? await readPastCleanupAuthorization(reader, runtime.db, uid, ledger, workout) : null;
  return { workout, strength, ...(suuntoWeightUnits === undefined ? {} : { suuntoWeightUnits }),
    ...(preferences.swimmingSettings ? { suuntoSwimmingSettings: preferences.swimmingSettings } : {}),
    ...(suuntoUnitSettings === undefined ? {} : { suuntoUnitSettings }),
    planActive: planDoc?.data()?.lifecycle === 'active',
    setting: workout?.planId ? (settingDoc?.data() ?? null) as TrainingDeliverySettingsV1 | null : override,
    override, scopeGeneration: scopeDoc?.data()?.generation ?? 0, connection, hasPro,
    transport: runtime.transport(provider, uid), nowMs: runtime.now(), pastCleanup };
}

export function projectDelivery(ledger: DeliveryLedgerV1): TrainingDeliveryStatusV1 {
  return { schemaVersion: 1, id: ledger.id, workoutId: ledger.workoutId, planId: ledger.planId, provider: ledger.provider,
    status: ledger.status, differsFromQS: !!ledger.actual && (ledger.verification?.missing === true
      || (ledger.provider === 'garmin' && ledger.verification?.observedMissingKeys?.includes('workout') === true) || ledger.desired === 'absent'
      || ledger.acceptedContentDigest !== ledger.contentDigest
      || ['unsupported', 'approval_required'].includes(ledger.status)),
    hasRemoteCopy: !!ledger.actual && !ledger.verification?.missing, timeZone: ledger.timeZone, approvalDigest: ledger.approvalDigest,
    issues: ledger.verification?.state === 'deferred' && ledger.verification.missing && ledger.verification.repairTimes.length >= 2
      ? ['Automatic restoration is paused after two repairs in 24 hours. It will resume at the next check.', ...ledger.issues].slice(0, 20) : ledger.issues,
    lastAttemptAtMs: ledger.lastAttemptAtMs, lastAcceptedAtMs: ledger.lastAcceptedAtMs,
    retryCount: ledger.retries, nextRetryAtMs: ledger.status === 'retrying' ? ledger.retryAtMs : null,
    updatedAtMs: ledger.updatedAtMs };
}

export function writeDelivery(runtime: DeliveryRuntime, tx: Transaction, uid: string, ledger: DeliveryLedgerV1): void {
  const user = runtime.db.collection('users').doc(uid);
  tx.set(user.collection(DELIVERY_LEDGER).doc(ledger.id), ledger);
  tx.set(user.collection(TRAINING_DELIVERY_STATUSES).doc(ledger.id), projectDelivery(ledger));
  const inspection = runtime.transport(ledger.provider, uid)?.inspection;
  tx.set(user.collection(TRAINING_DELIVERY_VERIFICATIONS).doc(ledger.id), projectVerification(ledger,
    !!inspection && inspection.policy.mode !== 'unavailable', runtime.now()));
}

function projectVerification(ledger: DeliveryLedgerV1, canInspect: boolean, nowMs: number): TrainingVerificationV1 {
  return {
    schemaVersion: 1, id: ledger.id, workoutId: ledger.workoutId, planId: ledger.planId, provider: ledger.provider,
    state: ledger.verification?.state ?? 'unsupported', canCheck: canInspect
      && ledger.desired === 'present' && !ledger.attempt && !!ledger.actual,
    missing: ledger.verification?.missing ?? false, lastCheckedAtMs: ledger.verification?.checkedAtMs ?? null,
    nextCheckAtMs: ledger.verification?.nextCheckAtMs ?? null, updatedAtMs: nowMs,
  };
}

export function queuedDeliveryOperation(record: DeliveryLedgerV1): 'upsert' | 'remove' | null {
  if (record.attempt) return record.attempt.kind;
  if (record.desired === 'present' && record.acceptedDigest !== record.desiredDigest) return 'upsert';
  if (record.desired === 'absent' && (record.actual || record.repair)) return 'remove';
  return null;
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
  const mappingApprovalProof = intent.mappingApprovalProof ?? previous?.mappingApprovalProof;
  const record: DeliveryLedgerV1 = { ...(previous?.verification ? { verification: structuredClone(previous.verification) } : {}),
    ...(previous?.suuntoGuideGeneration !== undefined ? { suuntoGuideGeneration: previous.suuntoGuideGeneration } : {}),
    ...(previous?.suuntoRetiredGuides ? { suuntoRetiredGuides: previous.suuntoRetiredGuides,
      suuntoRetiredExternalIds: previous.suuntoRetiredExternalIds ?? previous.suuntoRetiredGuides.map(item => item.ids.externalId) } : {}),
    ...(previous?.wahooPlanGeneration !== undefined ? { wahooPlanGeneration: previous.wahooPlanGeneration } : {}),
    ...(mappingApprovalProof ? { mappingApprovalProof } : {}),
    ...(context.pastCleanup ? { pastCleanup: context.pastCleanup } : {}),
    ...(previous?.providerAccessBlocked && !changed && !retried ? { providerAccessBlocked: true } : {}),
    ...(previous?.repair ? { repair: previous.repair } : {}),
    ...(previous?.completionLinkId ? { completionLinkId: previous.completionLinkId } : {}),
    schemaVersion: 1, id, workoutId,
    planId: intent.desired === 'absent' && context.pastCleanup?.scope === 'plan'
      && (previous?.actual || previous?.repair?.original)
      ? context.pastCleanup.scopeId : context.workout ? context.workout.planId : previous?.planId ?? null,
    provider, destinationKey,
    desiredGeneration: (previous?.desiredGeneration ?? 0) + (changed ? 1 : 0), desiredDigest: intent.digest,
    connectionEpoch: setting?.connectionEpoch ?? previous?.connectionEpoch ?? context.connection.epoch,
    settingsRevision: settingRevision, desired: intent.desired, status: intent.status, timeZone: intent.timeZone,
    issues: intent.issues, approvalDigest: intent.approvalDigest,
    actual: previous?.actual ?? null, acceptedDigest: previous?.acceptedDigest ?? null,
    contentDigest: deliveryContentDigest(context.workout, intent.timeZone, context.strength), acceptedContentDigest: previous?.acceptedContentDigest ?? null,
    attempt: previous?.attempt ?? null, lease: previous?.lease ?? null,
    retries: changed || retried ? 0 : previous.retries,
    retryAtMs: Math.max(changed || retried ? 0 : previous.retryAtMs, previous?.providerNotBeforeMs ?? 0),
    providerNotBeforeMs: previous?.providerNotBeforeMs ?? 0,
    blockedConnectionGeneration: previous?.blockedConnectionGeneration ?? null,
    lastAttemptAtMs: previous?.lastAttemptAtMs ?? null, lastAcceptedAtMs: previous?.lastAcceptedAtMs ?? null,
    updatedAtMs: runtime.now() };
  if (changed && record.verification?.missing && !record.attempt && record.desired === 'present' && !record.repair?.continuation) {
    record.repair = null;
    record.verification = { ...record.verification, binding: '', suspectedAtMs: null, state: 'pending', nextCheckAtMs: runtime.now() };
  }
  if (record.blockedConnectionGeneration === context.connection.generation) {
    record.status = previous!.status;
    record.desired = 'preserve';
  } else record.blockedConnectionGeneration = null;
  // An uncertain create is never cleared by a new edit or a user Retry.
  if (previous?.status === 'needs_attention' && previous.attempt && !retried) {
    record.status = 'needs_attention';
    // Keep the worker's explanation while its unresolved Wahoo journal remains
    // blocked; a periodic scan must not erase the deleted-Plan warning.
    if (provider === 'wahoo') record.issues = [...new Set([...previous.issues, ...record.issues])].slice(0, 20);
  }
  if (previous?.status === 'needs_attention' && previous.verification && !previous.attempt && !changed
    && intent.desired === 'present') {
    record.status = 'needs_attention';
    record.issues = [...new Set([...previous.issues, ...record.issues])].slice(0, 20);
  }
  if (previous?.status === 'failed' && !changed && !retried) record.status = 'failed';
  // Application access rejection is not repaired by periodic reconciliation or
  // user OAuth refresh. Keep its safe explanation until an edit or explicit Retry.
  if (record.providerAccessBlocked) {
    record.status = 'provider_unavailable'; record.issues = previous!.issues;
  }
  if (previous?.status === 'retrying' && !changed && !retried && previous.retryAtMs > runtime.now()) record.status = 'retrying';
  if ((record.providerNotBeforeMs ?? 0) > runtime.now() && ['pending', 'stopped', 'paused_plan'].includes(record.status)
    && (record.attempt || (record.desired === 'present' && record.acceptedDigest !== record.desiredDigest)
      || (record.desired === 'absent' && (record.actual || record.repair)))) record.status = 'retrying';
  if (record.desired === 'absent' && !record.actual && !record.repair && !record.attempt
    && record.status !== 'outside_horizon') record.status = 'removed';
  return record;
}

/** One resumable page. Current workouts and historical delivery identities are separate scans.
 * No page contains more than 25 recipes / 100 compact delivery records. */
export async function reconcileTrainingDeliveryPage(runtime: DeliveryRuntime, uid: string, reservation?: string): Promise<boolean> {
  const lease = await claimTrainingReconciliation(runtime, uid, reservation);
  if (!lease) return false;
  try {
    return await reconcileClaimedTrainingDeliveryPage(runtime, uid, lease);
  } catch (error) {
    // A failed release still has the durable lease deadline and minute dispatcher as recovery.
    await releaseFailedTrainingReconciliation(runtime, uid, lease).catch(() => undefined);
    throw error;
  }
}

async function reconcileClaimedTrainingDeliveryPage(runtime: DeliveryRuntime, uid: string, lease: string): Promise<boolean> {
  const { db } = runtime;
  const entitlement = runtime.entitlement ? await runtime.entitlement(uid) : { hasPro: await runtime.hasPro(uid) };
  const hasPro = entitlement.hasPro;
  const user = db.collection('users').doc(uid);
  const jobRef = db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid));
  return db.runTransaction(async tx => {
    const reads = new ReconciliationReads(runtime, tx, uid);
    if ((await getUserDeletionGuardStateInTransaction(db, tx, uid)).shouldSkip) return false;
    const [jobDoc, settingsState, locks, pendingTargets] = await Promise.all([
      tx.get(jobRef),
      tx.get(user.collection(DELIVERY_STATE).doc('current')),
      tx.get(user.collection('trainingPlanState').doc('current').collection('planDeletionLocks').limit(1)),
      tx.get(reconciliationTargets(db, uid).orderBy('requestedAt').limit(2)),
    ]);
    if (!jobDoc.exists) return false;
    const job = jobDoc.data()!;
    if (job.reconciliationLease?.token !== lease || job.reconciliationLease.expiresAtMs <= runtime.now()) return false;
    if (!(settingsState.data()?.revision > 0)) {
      // Manual authoring can stage targets before the first provider consent. Retire those
      // bounded private leaves as well; never leave a growing outbox for an unenrolled author.
      const unused = pendingTargets.size === 2
        ? await tx.get(reconciliationTargets(db, uid).orderBy('requestedAt').limit(TRAINING_DELIVERY_PAGE_SIZE + 1)) : pendingTargets;
      unused.docs.slice(0, TRAINING_DELIVERY_PAGE_SIZE).forEach(doc => tx.delete(doc.ref));
      const more = unused.size > TRAINING_DELIVERY_PAGE_SIZE;
      if (more) tx.set(jobRef, { reconciliationLease: null, dueAtMs: 0 }, { merge: true });
      else tx.delete(jobRef); // Queue records themselves remain leaves.
      return more;
    }
    if (!locks.empty) { tx.set(jobRef, { reconciliationLease: null, dueAtMs: runtime.now() + 60_000 }, { merge: true }); return false; }
    const globalGeneration = globalReconciliationGeneration(job);
    const resumeFullScan = typeof job.scanKey === 'string' && job.scanKey.startsWith('coordinated:');
    // A captured full-scan generation survives concurrent edits; the newer generation follows it.
    const fullScan = !!job.scanKey || (!job.targetWorkoutId && (job.completedGlobalGeneration !== globalGeneration
      || !(job.nextRepairAtMs > runtime.now()) || (job.nextTimeWakeAtMs ?? Infinity) <= runtime.now()));
    const scanKey = fullScan ? resumeFullScan ? job.scanKey : `coordinated:${globalGeneration}` : '';
    const capturedGeneration = fullScan && resumeFullScan ? job.scanGeneration ?? globalGeneration : globalGeneration;
    const targetId = fullScan ? '' : job.targetWorkoutId || pendingTargets.docs[0]?.id || '';
    const targetDoc = targetId ? await reads.get(reconciliationTargets(db, uid).doc(targetId)) : null;
    const targetGeneration = (job.targetWorkoutId ? job.targetGeneration : targetDoc?.data()?.generation) ?? 0;
    const nextRepairAtMs = job.nextRepairAtMs ?? runtime.now() + RECONCILIATION_REPAIR_MS;
    let nextTimeWakeAtMs = fullScan && !resumeFullScan ? Number.MAX_SAFE_INTEGER
      : job.nextTimeWakeAtMs ?? Number.MAX_SAFE_INTEGER;
    if (entitlement.nextChangeAtMs && entitlement.nextChangeAtMs > runtime.now()) {
      nextTimeWakeAtMs = Math.min(nextTimeWakeAtMs, entitlement.nextChangeAtMs);
    }
    if (!fullScan && !targetId) {
      tx.set(jobRef, { reconciliationLease: null, batchNotBeforeMs: 0, settledGeneration: job.generation ?? 0,
        dueAtMs: Math.min(nextRepairAtMs, nextTimeWakeAtMs) }, { merge: true });
      return false;
    }
    const phase = fullScan ? (resumeFullScan ? job.phase ?? 'workouts' : 'workouts') : 'target';
    const cursor = fullScan ? (resumeFullScan ? job.cursor ?? '' : '') : job.targetCursor ?? '';
    let query = phase === 'workouts'
      ? user.collection('scheduledWorkouts').where('lifecycle', 'in', ['planned', 'skipped']).orderBy(FieldPath.documentId())
      : phase === 'target' ? user.collection(DELIVERY_LEDGER).where('workoutId', '==', targetId).orderBy(FieldPath.documentId())
        : user.collection(DELIVERY_LEDGER).orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query.limit(TRAINING_DELIVERY_PAGE_SIZE));
    const records: { record: DeliveryLedgerV1; previous: DeliveryLedgerV1 | null; context: DeliveryContext;
      requestedAtMs: number; status: FirebaseFirestore.DocumentData | undefined;
      verification: FirebaseFirestore.DocumentData | undefined }[] = [];
    const dayBoundaries = new Map<string, number>();
    const retain = async (record: DeliveryLedgerV1, previous: DeliveryLedgerV1 | null, context: DeliveryContext) => {
      if (records.some(item => item.record.id === record.id)) return;
      // A retained provider copy can still use the zone saved before a settings edit.
      // Intent protects it at that zone's day boundary as well as the current setting's.
      for (const zone of [record.timeZone, record.actual?.timeZone, record.repair?.original.timeZone]) {
        if (!zone) continue;
        if (!dayBoundaries.has(zone)) dayBoundaries.set(zone, nextTrainingLocalDay(runtime.now(), zone));
        nextTimeWakeAtMs = Math.min(nextTimeWakeAtMs, dayBoundaries.get(zone)!);
      }
      const [status, verification, requestedAtMs] = await Promise.all([
        reads.get(user.collection(TRAINING_DELIVERY_STATUSES).doc(record.id)),
        reads.get(user.collection(TRAINING_DELIVERY_VERIFICATIONS).doc(record.id)),
        context.transport?.inspection ? readVerificationRequest(runtime, reads, uid, record) : 0,
      ]);
      records.push({ record, previous, context, requestedAtMs, status: status.data(), verification: verification.data() });
    };
    const reconcileWorkout = async (workout: ScheduledWorkoutV1) => {
        for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
          const context = await readDeliveryContext(runtime, tx, uid, workout, provider, hasPro, undefined, undefined, reads);
          if (!context.setting?.enabled || !context.connection.destinationKey) continue;
          const id = deliveryIdentity(uid, provider, context.connection.destinationKey, workout.id);
          const stored = await reads.get(user.collection(DELIVERY_LEDGER).doc(id));
          const previous = (stored.data() ?? null) as DeliveryLedgerV1 | null;
          context.pastCleanup = await readPastCleanupAuthorization(reads, db, uid, previous, workout);
          const record = reconcileRecord(runtime, context, uid, provider, workout.id, previous);
          if (record) await retain(record, previous, context);
        }
    };
    // A targeted edit visits its current identities and every retained destination, including
    // deleted recipes, stopped consent and former accounts. Never select only the current account.
    if (phase === 'target' && !cursor) {
      const workoutDoc = await reads.get(user.collection('scheduledWorkouts').doc(targetId));
      if (workoutDoc.exists) {
        const workout = parseScheduledWorkoutV1(workoutDoc.data());
        if (['planned', 'skipped'].includes(workout.lifecycle)) await reconcileWorkout(workout);
      }
    }
    for (const doc of page.docs) {
      if (phase === 'workouts') await reconcileWorkout(parseScheduledWorkoutV1(doc.data()));
      else {
        const previous = doc.data() as DeliveryLedgerV1;
        const workoutDoc = await reads.get(user.collection('scheduledWorkouts').doc(previous.workoutId));
        const context = await readDeliveryContext(runtime, tx, uid, workoutDoc.exists ? parseScheduledWorkoutV1(workoutDoc.data()) : null,
          previous.provider, hasPro, previous.workoutId, previous, reads);
        const record = reconcileRecord(runtime, context, uid, previous.provider, previous.workoutId, previous);
        if (record) await retain(record, previous, context);
      }
    }
    for (const { record, previous, context, requestedAtMs, status, verification } of records) {
      const operationKind = queuedDeliveryOperation(record);
      if (operationKind && !record.providerAccessBlocked && !['failed', 'needs_attention'].includes(record.status)
        && !(record.verification?.missing && !record.repair)) {
        tx.set(db.collection(DELIVERY_QUEUE).doc(record.id), { uid, kind: 'delivery', deliveryId: record.id,
          provider: record.provider, destinationKey: record.destinationKey, operationKind,
          dueAtMs: Math.max(record.retryAtMs, record.lease?.expiresAtMs ?? 0), dispatchToken: randomUUID() });
      } else stageVerification(runtime, tx, uid, record, context, requestedAtMs);
      // A source edit needs an acknowledgement even when its provider payload is identical.
      const sourceUpdatedAtMs = Math.max(context.workout?.updatedAtMs ?? 0,
        context.setting?.updatedAtMs ?? 0, context.override?.updatedAtMs ?? 0);
      if (previous && previous.updatedAtMs >= sourceUpdatedAtMs
        && isDeepStrictEqual(previous, { ...record, updatedAtMs: previous.updatedAtMs })) record.updatedAtMs = previous.updatedAtMs;
      if (!isDeepStrictEqual(previous, record)) tx.set(user.collection(DELIVERY_LEDGER).doc(record.id), record);
      const projectedStatus = projectDelivery(record);
      if (!isDeepStrictEqual(status, projectedStatus)) tx.set(user.collection(TRAINING_DELIVERY_STATUSES).doc(record.id), projectedStatus);
      const inspection = context.transport?.inspection;
      const projectedVerification = projectVerification(record, !!inspection && inspection.policy.mode !== 'unavailable', runtime.now());
      // Read both projections above so absent/stale views are repaired, even for an unchanged private ledger.
      if (!verification || !Number.isSafeInteger(verification.updatedAtMs) || verification.updatedAtMs < 0
        || !isDeepStrictEqual(verification, { ...projectedVerification, updatedAtMs: verification.updatedAtMs })) {
        tx.set(user.collection(TRAINING_DELIVERY_VERIFICATIONS).doc(record.id), projectedVerification);
      }
    }
    const finished = page.size < TRAINING_DELIVERY_PAGE_SIZE && phase !== 'workouts';
    const nextPhase = page.size < TRAINING_DELIVERY_PAGE_SIZE ? 'ledger' : phase;
    const targetUnchanged = !targetDoc?.exists || targetDoc.data()?.generation === targetGeneration;
    const remainingTargets = fullScan ? !pendingTargets.empty
      : pendingTargets.docs.some(doc => doc.id !== targetId) || !targetUnchanged;
    const globalPending = globalGeneration !== (fullScan ? capturedGeneration : job.completedGlobalGeneration);
    const more = !finished || globalPending || remainingTargets;
    if (finished && !fullScan && targetUnchanged && targetDoc?.exists) tx.delete(targetDoc.ref);
    const repairedAtMs = finished && fullScan ? runtime.now() + RECONCILIATION_REPAIR_MS : nextRepairAtMs;
    tx.set(jobRef, { scanKey: finished ? '' : scanKey, scanGeneration: capturedGeneration, phase: nextPhase,
      cursor: !fullScan || finished || nextPhase !== phase ? '' : page.docs[page.docs.length - 1]?.id ?? '',
      targetWorkoutId: !fullScan && !finished ? targetId : '',
      targetGeneration: !fullScan && !finished ? targetGeneration : 0,
      targetCursor: !fullScan && !finished ? page.docs[page.docs.length - 1]?.id ?? '' : '',
      ...(finished && fullScan ? { completedGlobalGeneration: capturedGeneration } : {}),
      nextRepairAtMs: repairedAtMs, nextTimeWakeAtMs, reconciliationLease: null,
      ...(!more ? { batchNotBeforeMs: 0, settledGeneration: job.generation ?? 0 } : {}),
      dueAtMs: more ? 0 : Math.min(repairedAtMs, nextTimeWakeAtMs), dispatchToken: randomUUID(),
    }, { merge: true });
    return more;
  });
}
