import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { deliverySettingsId, GARMIN_WORKOUT_NOT_FOUND_ISSUE, parseTrainingDeliveryCommandV1, TrainingDeliveryContractError,
  TRAINING_DELIVERY_SETTINGS, trainingDeliveryLocalDate, type TrainingDeliveryCommandV1,
  type TrainingDeliveryPreviewV1, type TrainingDeliverySettingsV1 } from '../../../../shared/training-provider-delivery';
import { enforceAppCheck } from '../../utils';
import { FUNCTION_SECRET_BINDINGS } from '../../secrets';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { hashTrainingScheduleRequestPayload } from '../persistence';
import { assertNoTrainingPlanDeletionInProgress } from '../deletion-lock';
import { TrainingScheduleMutationError } from '../mutation';
import { DELIVERY_LEDGER, DELIVERY_RECEIPTS, DELIVERY_SCOPES, DELIVERY_STATE, requiresDeliveryMappingApproval,
  type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { deliveryIdentity, resolveDeliveryIntent } from './intent';
import { assessTrainingDeliveryMapping } from './mapping';
import { stageTrainingDeliveryReconciliation } from './marker';
import { readDeliveryContext, readStrengthDetailsForDelivery, readSuuntoGuideOwnerPreferences, writeDelivery } from './store';
import { productionDeliveryRuntime } from './runtime';
import type { TrainingVerificationReceiptV1 } from '../../../../shared/training-provider-verification';
import { VERIFICATION_COALESCE_MS, VERIFICATION_DAY_MS } from './verification-contracts';
import { inspectionBinding } from './verification-evidence';

export async function trainingDeliveryCommand(runtime: DeliveryRuntime, uid: string, raw: unknown,
  previewOnly: boolean,
  transactionPrecondition?: (tx: FirebaseFirestore.Transaction) => Promise<void>,
): Promise<TrainingDeliveryPreviewV1 | TrainingDeliverySettingsV1 | TrainingVerificationReceiptV1> {
  const command: TrainingDeliveryCommandV1 = parseTrainingDeliveryCommandV1(raw);
  const user = runtime.db.collection('users').doc(uid);
  const privateState = user.collection(DELIVERY_STATE).doc('current');
  const receiptRef = privateState.collection(DELIVERY_RECEIPTS).doc(command.mutationId);
  const hash = hashTrainingScheduleRequestPayload(command);
  const pro = await runtime.hasPro(uid);
  return runtime.db.runTransaction(async tx => {
    if ((await getUserDeletionGuardStateInTransaction(runtime.db, tx, uid)).shouldSkip) {
      throw new HttpsError('failed-precondition', 'This account is unavailable or being deleted.');
    }
    // Keep any caller-specific authority check in the same transaction as the
    // delivery settings write so a concurrent revocation aborts the commit.
    await transactionPrecondition?.(tx);
    if (!previewOnly) {
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data()!.hash !== hash) throw new HttpsError('failed-precondition', 'Mutation ID already used.');
        return receipt.data()!.result as TrainingDeliverySettingsV1;
      }
    }
    const stateRef = user.collection('trainingPlanState').doc('current');
    await assertNoTrainingPlanDeletionInProgress(tx, stateRef);
    const settingRef = user.collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId(command.scope, command.scopeId, command.provider));
    const [schedule, scope, settingDoc, state, generationDoc] = await Promise.all([
      tx.get(stateRef), tx.get(user.collection(command.scope === 'plan' ? 'trainingPlans' : 'scheduledWorkouts').doc(command.scopeId)),
      tx.get(settingRef), tx.get(privateState), tx.get(user.collection(DELIVERY_SCOPES).doc(command.scopeId)),
    ]);
    if (!scope.exists && command.scope === 'plan') throw new HttpsError('not-found', 'The plan no longer exists.');
    const retired = command.scope === 'workout' && (!scope.exists || scope.data()?.lifecycle === 'deleted');
    if (retired && !['stop', 'retry'].includes(command.action)) {
      throw new HttpsError('failed-precondition', 'Deleted workouts permit only delivery recovery or Stop sync.');
    }
    const previous = (settingDoc.data() ?? null) as TrainingDeliverySettingsV1 | null;
    if ((schedule.data()?.revision ?? 0) !== command.expectedScheduleRevision
      || (scope.data()?.revision ?? 0) !== command.expectedScopeRevision
      || (previous?.revision ?? 0) !== command.expectedSettingsRevision) {
      throw new HttpsError('aborted', 'The schedule or delivery settings changed. Refresh and try again.');
    }
    const connection = await runtime.connection(tx, uid, command.provider);
    const transport = runtime.transport(command.provider, uid);
    if (command.action === 'check') {
      if (previewOnly) throw new HttpsError('invalid-argument', 'Remote checks use the mutation command, not a preview.');
      if (!pro) throw new HttpsError('permission-denied', 'Remote checking requires Pro or an active grace period.');
      if (!transport?.inspection || transport.inspection.policy.mode === 'unavailable') throw new HttpsError('failed-precondition', 'Remote checking is unavailable.');
      if (connection.state !== 'connected') throw new HttpsError('failed-precondition', 'Check your provider connection first.');
      const checkRef = privateState.collection('checks').doc(deliverySettingsId(command.scope, command.scopeId, command.provider));
      const prior = await tx.get(checkRef);
      const now = runtime.now();
      const coalesced = prior.exists && prior.data()!.requestedAtMs > now - VERIFICATION_COALESCE_MS;
      const notBeforeMs = Math.max(now, await runtime.requestNotBefore?.(tx, uid, command.provider, connection.destinationKey) ?? now);
      const result: TrainingVerificationReceiptV1 = { schemaVersion: 1, action: 'check', result: coalesced ? 'coalesced' : notBeforeMs > now ? 'deferred' : 'queued',
        requestedAtMs: coalesced ? prior.data()!.requestedAtMs : now, notBeforeMs };
      if (!coalesced) {
        tx.set(checkRef, { requestedAtMs: now });
        stageTrainingDeliveryReconciliation(tx, runtime.db, uid, command.scope === 'workout' ? [command.scopeId] : undefined);
      }
      tx.create(receiptRef, { hash, result, createdAtMs: now, expireAt: Timestamp.fromMillis(now + 30 * 86_400_000) });
      return result;
    }
    // A deleted source can recover only a server-owned identity for this exact account.
    // Never recreate authored data, consent, or an identity from a client-supplied remote ID.
    const retained = retired ? (await tx.get(user.collection(DELIVERY_LEDGER).doc(
      deliveryIdentity(uid, command.provider, connection.destinationKey, command.scopeId)))).data() as DeliveryLedgerV1 | undefined : undefined;
    if (retired && !retained) throw new HttpsError('not-found', 'No retained delivery exists for this workout and connected account.');
    const workout = command.scope === 'workout' && scope.exists ? parseScheduledWorkoutV1(scope.data()) : null;
    const inherited = workout?.planId ? await tx.get(user.collection(TRAINING_DELIVERY_SETTINGS)
      .doc(deliverySettingsId('plan', workout.planId, command.provider))) : null;
    const planSetting = (inherited?.data() ?? null) as TrainingDeliverySettingsV1 | null;
    const enable = ['configure', 'send', 'resume'].includes(command.action);
    const currentOverride = previous && previous.scopeGeneration === (generationDoc.data()?.generation ?? 0)
      && previous.associationPlanId === (workout?.planId ?? null) ? previous : null;
    const timeZone = retired ? retained!.timeZone : workout?.planId ? planSetting?.timeZone ?? 'UTC'
      : (enable ? command.timeZone : undefined) ?? previous?.timeZone ?? 'UTC';
    if (workout?.planId && command.timeZone && command.timeZone !== timeZone) {
      throw new HttpsError('failed-precondition', 'Plan workouts inherit the plan delivery time zone. Change it in the plan provider settings.');
    }
    if (command.action === 'resume' && !workout?.planId && !previous) {
      throw new HttpsError('failed-precondition', 'Use Send to give initial standalone consent and choose a time zone.');
    }
    const workouts = workout ? [workout] : command.scope === 'workout' ? [] : (await tx.get(user.collection('scheduledWorkouts')
      .where('planId', '==', command.scopeId).where('lifecycle', 'in', ['planned', 'skipped']).limit(401)))
      .docs.map(doc => parseScheduledWorkoutV1(doc.data()));
    if (workouts.length > 400) throw new HttpsError('resource-exhausted', 'Plan exceeds the delivery limit.');
    const today = trainingDeliveryLocalDate(runtime.now(), timeZone);
    const strengths = await Promise.all(workouts.map(item => readStrengthDetailsForDelivery(tx, user, item)));
    const preferences = await readSuuntoGuideOwnerPreferences(tx, user, command.provider, workouts);
    const suuntoUnitSettings = preferences.unitSettings;
    const suuntoLedgers = command.provider === 'suunto' ? await Promise.all(workouts.map(item => tx.get(user.collection(DELIVERY_LEDGER)
      .doc(deliveryIdentity(uid, 'suunto', connection.destinationKey, item.id))))) : [];
    const assessments = workouts.map((item, index) => transport?.assess(item, connection.destinationKey, timeZone,
      strengths[index], strengths[index] ? suuntoUnitSettings?.weightUnits : undefined, suuntoUnitSettings, undefined, preferences.swimmingSettings,
      undefined, suuntoLedgers[index]?.get('suuntoGuideGeneration'))
      ?? assessTrainingDeliveryMapping(command.provider, item, connection.destinationKey, timeZone, strengths[index]));
    const fresh = command.action === 'fresh-guide' ? suuntoLedgers[0]?.data() as DeliveryLedgerV1 | undefined : undefined;
    let freshDigest: string | null = null;
    let freshAssessment: ReturnType<NonNullable<typeof transport>['assess']> | null = null;
    if (command.action === 'fresh-guide') {
      const context = fresh && workout ? await readDeliveryContext(runtime, tx, uid, workout, 'suunto', pro, workout.id, fresh) : null;
      const completion = await tx.get(user.collection('trainingWorkoutCompletions').doc(command.scopeId));
      const intent = context && fresh ? resolveDeliveryIntent(context, fresh) : null;
      const generation = fresh?.suuntoGuideGeneration ?? 0;
      const retiredGuides = fresh?.suuntoRetiredGuides ?? [];
      if (!fresh || !workout || !context || !transport || !pro || connection.state !== 'connected'
        || fresh.provider !== 'suunto' || fresh.planId !== workout.planId || fresh.destinationKey !== connection.destinationKey || fresh.connectionEpoch !== connection.epoch
        || fresh.attempt || fresh.repair || fresh.lease && fresh.lease.expiresAtMs > runtime.now()
        || !fresh.actual?.ids.guide || !fresh.actual.ids.externalId || !fresh.actual.ids.owner
        || fresh.actual.completed || fresh.completionLinkId || completion.exists
        || !Number.isSafeInteger(generation) || generation < 0 || generation >= 8 || retiredGuides.length >= 8
        || retiredGuides.some(item => item.completed) || fresh.actual.localDate < today
        || typeof fresh.lastAcceptedAtMs !== 'number' || !Number.isSafeInteger(fresh.lastAcceptedAtMs) || fresh.lastAcceptedAtMs < 0
        || intent?.desired !== 'present' || !['delivered', 'pending'].includes(intent.status)
        || !['delivered', 'pending'].includes(fresh.status)) {
        throw new HttpsError('failed-precondition', 'A fresh Guide requires an upcoming, uncompleted workout with current sync consent and a confirmed earlier send. Resolve unfinished sends first. After eight fresh copies, duplicate the workout instead.');
      }
      freshAssessment = transport.assess(workout, connection.destinationKey, timeZone, context.strength,
        context.suuntoWeightUnits, context.suuntoUnitSettings, undefined, context.suuntoSwimmingSettings, undefined, generation + 1);
      if (freshAssessment.level === 'unsupported') throw new HttpsError('failed-precondition', 'This workout cannot be sent as a Suunto Guide.');
      freshDigest = hashTrainingScheduleRequestPayload({ action: 'fresh-guide', generation, artifact: fresh.actual,
        destination: connection.destinationKey, epoch: connection.epoch, scopeGeneration: context.scopeGeneration,
        digest: freshAssessment.digest, contentDigest: fresh.contentDigest,
        scheduleRevision: command.expectedScheduleRevision, scopeRevision: command.expectedScopeRevision,
        settingsRevision: command.expectedSettingsRevision });
    }
    // No provider HTTP in previews/transactions. Only the server's current, complete
    // inspection can offer recovery; the worker independently reinspects before POST.
    const replacementRef = command.action === 'replace' ? user.collection(DELIVERY_LEDGER).doc(
      deliveryIdentity(uid, command.provider, connection.destinationKey, command.scopeId)) : null;
    const replacement = replacementRef ? (await tx.get(replacementRef)).data() as DeliveryLedgerV1 | undefined : undefined;
    const replacementContext = replacement && workout
      ? await readDeliveryContext(runtime, tx, uid, workout, command.provider, pro, workout.id, replacement) : null;
    let replacementDigest: string | null = null;
    if (command.action === 'replace') {
      const policy = transport?.inspection?.policy;
      const evidence = replacement?.verification;
      const now = runtime.now();
      const intent = replacementContext ? resolveDeliveryIntent(replacementContext, replacement) : null;
      if (!replacement || !replacementContext || !policy || policy.version !== 'garmin-retained-v2-schedule-repair'
        || !pro || connection.state !== 'connected' || replacement.destinationKey !== connection.destinationKey
        || replacement.connectionEpoch !== connection.epoch || replacement.attempt || replacement.repair
        || (replacement.lease && replacement.lease.expiresAtMs > runtime.now())
        || !replacement.actual?.ids.workout || !replacement.actual.ids.schedule || !replacement.actual.ids.owner
        || replacement.actual.completed || replacement.actual.localDate < today
        || typeof replacement.lastAcceptedAtMs !== 'number' || !Number.isSafeInteger(replacement.lastAcceptedAtMs)
        || replacement.lastAcceptedAtMs < 0 || intent?.desired !== 'present'
        || !['delivered', 'pending'].includes(intent.status) || intent.digest !== replacement.desiredDigest
        || replacement.status !== 'needs_attention' || evidence?.state !== 'unknown'
        || !Array.isArray(evidence.observedMissingKeys) || evidence.observedMissingKeys.length !== 2
        || !evidence.observedMissingKeys.includes('workout') || !evidence.observedMissingKeys.includes('schedule')
        || typeof evidence.checkedAtMs !== 'number' || !Number.isSafeInteger(evidence.checkedAtMs) || evidence.checkedAtMs < 0
        || evidence.checkedAtMs > now || evidence.checkedAtMs < now - VERIFICATION_DAY_MS
        || evidence.binding !== inspectionBinding(replacement, replacementContext, policy)) {
        throw new HttpsError('failed-precondition', 'Check Garmin again and review the current workout before creating a replacement. An unfinished send, changed account, past or completed workout cannot be replaced.');
      }
      replacementDigest = hashTrainingScheduleRequestPayload({ action: 'replace', binding: evidence.binding,
        checkedAtMs: evidence.checkedAtMs, missing: evidence.observedMissingKeys,
        scheduleRevision: command.expectedScheduleRevision, scopeRevision: command.expectedScopeRevision });
    }
    const preview: TrainingDeliveryPreviewV1 = { schemaVersion: 1, available: !!transport,
      connection: connection.state, hasPro: pro, timeZone,
      effect: command.action === 'fresh-guide' ? 'fresh-guide' : command.action === 'replace' ? 'replace' : command.action === 'stop' ? 'remove-future-copies' : command.action === 'retry' ? 'retry' : command.action === 'approve' ? 'approve' : 'enable',
      settingsRevision: previous?.revision ?? 0,
      eligibleCount: workouts.filter(item => item.lifecycle === 'planned' && item.localDate >= today
        && (!transport || (Date.parse(item.localDate) - Date.parse(today)) / 86_400_000 <= transport.horizonDays)).length,
      warningCount: assessments.filter(item => item.level !== 'exact').length,
      approvalRequiredCount: assessments.filter(requiresDeliveryMappingApproval).length,
      issues: [...new Set([...(freshDigest ? ['Suunto app/watch visibility cannot be checked. This creates a new Guide identity; the earlier Guide is left untouched and may still be visible. Your QS workout, other providers and recordings stay unchanged.'] : []), ...(replacementDigest ? [GARMIN_WORKOUT_NOT_FOUND_ISSUE,
        'Creating a new Garmin copy can leave a duplicate if the old copy becomes visible again. QS will recheck before sending; other providers and completed activities are unchanged.'] : []),
        ...(connection.issues ?? []), ...assessments.flatMap(item => item.issues)])].slice(0, 20),
      approvalDigest: freshDigest ?? replacementDigest ?? (workout && requiresDeliveryMappingApproval(assessments[0]) ? assessments[0].digest : null),
      workoutCompatibility: workout ? assessments[0]?.level ?? null : null };
    if (previewOnly) return preview;
    if (command.action === 'replace' && command.approvalDigest !== replacementDigest) {
      throw new HttpsError('aborted', 'Review and confirm the latest Garmin replacement preview.');
    }
    if (command.action === 'fresh-guide' && command.approvalDigest !== freshDigest) {
      throw new HttpsError('aborted', 'Review and confirm the latest fresh Guide preview.');
    }
    const removal = command.action === 'stop';
    // Retry never grants consent. Workers still enforce Pro for creates/updates, while
    // an existing withdrawal or ambiguous acceptance must remain recoverable after expiry.
    if (!removal && command.action !== 'retry' && !pro) throw new HttpsError('permission-denied', 'Provider delivery requires Pro or an active grace period.');
    if (!removal && !transport) throw new HttpsError('failed-precondition', 'This provider is not yet available for workout delivery.');
    if (!removal && connection.state !== 'connected') throw new HttpsError('failed-precondition', 'Repair or reconnect this provider connection first.');
    if (command.action === 'send' && workout?.planId) throw new HttpsError('failed-precondition', 'Plan workouts use plan provider settings.');
    if (workout && ['send', 'resume'].includes(command.action) && assessments[0]?.level === 'unsupported') {
      throw new HttpsError('failed-precondition', 'This workout cannot be sent to the selected provider. Review its sport and step endings before enabling sync.');
    }
    if (retired && retained!.connectionEpoch !== connection.epoch) {
      throw new HttpsError('failed-precondition', 'Access was explicitly revoked. Provider-held copies may need removing in the provider app.');
    }
    if (!retired && ['retry', 'approve'].includes(command.action)) {
      const consent = workout?.planId ? currentOverride?.suppressed ? currentOverride : planSetting : previous;
      if (!consent || (command.action === 'approve' && !consent.enabled) || consent.destinationKey !== connection.destinationKey || consent.connectionEpoch !== connection.epoch
        || (consent.scope === 'workout' && (consent.scopeGeneration !== (generationDoc.data()?.generation ?? 0)
          || consent.associationPlanId !== (workout?.planId ?? null)))) {
        throw new HttpsError('failed-precondition', 'Fresh provider consent is required.');
      }
    }
    if (workout?.planId && enable && (!planSetting?.enabled || planSetting.destinationKey !== connection.destinationKey
      || planSetting.connectionEpoch !== connection.epoch)) throw new HttpsError('failed-precondition', 'Enable this provider on the plan first.');
    if (command.approvalDigest && preview.approvalDigest !== command.approvalDigest) {
      throw new HttpsError('aborted', 'The compatibility preview changed. Review the latest warnings.');
    }
    const revision = (state.data()?.revision ?? 0) + 1;
    const result: TrainingDeliverySettingsV1 = { schemaVersion: 1, scope: command.scope, scopeId: command.scopeId,
      provider: command.provider, revision, enabled: removal || retired ? false : enable ? true : previous?.enabled ?? false,
      suppressed: enable ? false : removal && command.scope === 'workout' ? true : currentOverride?.suppressed ?? false, timeZone,
      destinationKey: removal ? previous?.destinationKey ?? planSetting?.destinationKey ?? connection.destinationKey : connection.destinationKey,
      connectionEpoch: removal ? previous?.connectionEpoch ?? planSetting?.connectionEpoch ?? connection.epoch : connection.epoch,
      scopeGeneration: generationDoc.data()?.generation ?? 0, associationPlanId: workout?.planId ?? null,
      approvedDigest: command.action === 'approve' || command.action === 'send'
        ? command.approvalDigest ?? null : command.action === 'retry' ? previous?.approvedDigest ?? null : null,
      updatedAtMs: runtime.now() };
    if (replacement && replacementContext && replacementRef) {
      // Preserve mapping approval and consent. Replacement approval is one operation,
      // not permission to broaden provider delivery or change the prescription.
      result.approvedDigest = previous?.approvedDigest ?? null;
      const context = { ...replacementContext, override: result,
        setting: workout?.planId ? replacementContext.setting : result };
      replacement.repair = { manualReplacement: true, policyVersion: transport!.inspection!.policy.version,
        binding: inspectionBinding(replacement, context, transport!.inspection!.policy),
        missing: [...replacement.verification!.observedMissingKeys!], original: replacement.actual! };
      replacement.acceptedDigest = null;
      replacement.status = 'pending';
      replacement.verification = { ...replacement.verification!, state: 'restoring' };
      replacement.updatedAtMs = runtime.now();
      writeDelivery(runtime, tx, uid, replacement);
    }
    if (fresh && freshAssessment) {
      // Rotate identity only under this explicit receipt-bound approval. Never
      // delete the earlier Guide or reinterpret app hiding as authoritative absence.
      result.approvedDigest = requiresDeliveryMappingApproval(freshAssessment) ? freshAssessment.digest : previous?.approvedDigest ?? null;
      fresh.suuntoGuideGeneration = (fresh.suuntoGuideGeneration ?? 0) + 1;
      fresh.suuntoRetiredGuides = [...(fresh.suuntoRetiredGuides ?? []), { ...fresh.actual!, planId: fresh.planId }];
      fresh.suuntoRetiredExternalIds = fresh.suuntoRetiredGuides.map(item => item.ids.externalId);
      fresh.actual = null; fresh.acceptedDigest = null; fresh.acceptedContentDigest = null;
      fresh.status = 'pending'; fresh.lease = null;
      delete fresh.verification;
      fresh.updatedAtMs = runtime.now();
      writeDelivery(runtime, tx, uid, fresh);
    }
    tx.set(settingRef, result);
    tx.set(privateState, { revision }, { merge: true });
    tx.create(receiptRef, { hash, result, createdAtMs: runtime.now(), expireAt: Timestamp.fromMillis(runtime.now() + 30 * 86_400_000) });
    stageTrainingDeliveryReconciliation(tx, runtime.db, uid, command.scope === 'workout' ? [command.scopeId] : undefined);
    return result;
  });
}

const handle = (previewOnly: boolean) => async (request: CallableRequest<unknown>) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to manage delivery.');
  enforceAppCheck(request);
  try { return await trainingDeliveryCommand(productionDeliveryRuntime(), request.auth.uid, request.data, previewOnly); }
  catch (error) {
    if (error instanceof TrainingDeliveryContractError) throw new HttpsError('invalid-argument', error.message);
    if (error instanceof TrainingScheduleMutationError && error.code === 'failed-precondition') {
      throw new HttpsError('failed-precondition', error.message);
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('internal', 'Unable to update provider delivery.');
  }
};
export const previewTrainingProviderDelivery = onCall({
  region: FUNCTIONS_MANIFEST.previewTrainingProviderDelivery.region,
  memory: '512MiB',
  secrets: FUNCTION_SECRET_BINDINGS.previewTrainingProviderDelivery,
}, handle(true));
export const mutateTrainingProviderDelivery = onCall({
  region: FUNCTIONS_MANIFEST.mutateTrainingProviderDelivery.region,
  memory: '512MiB',
  secrets: FUNCTION_SECRET_BINDINGS.mutateTrainingProviderDelivery,
}, handle(false));
