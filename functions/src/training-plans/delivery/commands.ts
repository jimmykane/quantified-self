import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { parseScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { deliverySettingsId, parseTrainingDeliveryCommandV1, TrainingDeliveryContractError,
  TRAINING_DELIVERY_SETTINGS, trainingDeliveryLocalDate, type TrainingDeliveryCommandV1,
  type TrainingDeliveryPreviewV1, type TrainingDeliverySettingsV1 } from '../../../../shared/training-provider-delivery';
import { enforceAppCheck } from '../../utils';
import { getUserDeletionGuardStateInTransaction } from '../../shared/user-deletion-guard';
import { hashTrainingScheduleRequestPayload } from '../persistence';
import { assertNoTrainingPlanDeletionInProgress } from '../deletion-lock';
import { TrainingScheduleMutationError } from '../mutation';
import { DELIVERY_LEDGER, DELIVERY_RECEIPTS, DELIVERY_SCOPES, DELIVERY_STATE, type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { deliveryIdentity } from './intent';
import { assessTrainingDeliveryMapping } from './mapping';
import { stageTrainingDeliveryReconciliation } from './marker';
import { productionDeliveryRuntime } from './runtime';

export async function trainingDeliveryCommand(runtime: DeliveryRuntime, uid: string, raw: unknown,
  previewOnly: boolean): Promise<TrainingDeliveryPreviewV1 | TrainingDeliverySettingsV1> {
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
    const assessments = workouts.map(item => transport?.assess(item, connection.destinationKey, timeZone)
      ?? assessTrainingDeliveryMapping(command.provider, item, connection.destinationKey, timeZone));
    const preview: TrainingDeliveryPreviewV1 = { schemaVersion: 1, available: !!transport,
      connection: connection.state, hasPro: pro, timeZone,
      effect: command.action === 'stop' ? 'remove-future-copies' : command.action === 'retry' ? 'retry' : command.action === 'approve' ? 'approve' : 'enable',
      settingsRevision: previous?.revision ?? 0,
      eligibleCount: workouts.filter(item => item.lifecycle === 'planned' && item.localDate >= today
        && (!transport || (Date.parse(item.localDate) - Date.parse(today)) / 86_400_000 <= transport.horizonDays)).length,
      warningCount: assessments.filter(item => item.level !== 'exact').length,
      issues: [...new Set(assessments.flatMap(item => item.issues))].slice(0, 20),
      approvalDigest: workout && assessments[0]?.level === 'degraded' ? assessments[0].digest : null };
    if (previewOnly) return preview;
    const removal = command.action === 'stop';
    // Retry never grants consent. Workers still enforce Pro for creates/updates, while
    // an existing withdrawal or ambiguous acceptance must remain recoverable after expiry.
    if (!removal && command.action !== 'retry' && !pro) throw new HttpsError('permission-denied', 'Provider delivery requires Pro or an active grace period.');
    if (!removal && !transport) throw new HttpsError('failed-precondition', 'This provider is not yet available for workout delivery.');
    if (!removal && connection.state !== 'connected') throw new HttpsError('failed-precondition', 'Repair or reconnect this provider connection first.');
    if (command.action === 'send' && workout?.planId) throw new HttpsError('failed-precondition', 'Plan workouts use plan provider settings.');
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
    if (command.action === 'approve' && (preview.approvalDigest !== command.approvalDigest || !preview.approvalDigest)) {
      throw new HttpsError('aborted', 'The compatibility preview changed. Review the latest warnings.');
    }
    const revision = (state.data()?.revision ?? 0) + 1;
    const result: TrainingDeliverySettingsV1 = { schemaVersion: 1, scope: command.scope, scopeId: command.scopeId,
      provider: command.provider, revision, enabled: removal || retired ? false : enable ? true : previous?.enabled ?? false,
      suppressed: enable ? false : removal && command.scope === 'workout' ? true : currentOverride?.suppressed ?? false, timeZone,
      destinationKey: removal ? previous?.destinationKey ?? planSetting?.destinationKey ?? connection.destinationKey : connection.destinationKey,
      connectionEpoch: removal ? previous?.connectionEpoch ?? planSetting?.connectionEpoch ?? connection.epoch : connection.epoch,
      scopeGeneration: generationDoc.data()?.generation ?? 0, associationPlanId: workout?.planId ?? null,
      approvedDigest: command.action === 'approve' ? command.approvalDigest! : command.action === 'retry' ? previous?.approvedDigest ?? null : null,
      updatedAtMs: runtime.now() };
    tx.set(settingRef, result);
    tx.set(privateState, { revision }, { merge: true });
    tx.create(receiptRef, { hash, result, createdAtMs: runtime.now(), expireAt: Timestamp.fromMillis(runtime.now() + 30 * 86_400_000) });
    stageTrainingDeliveryReconciliation(tx, runtime.db, uid);
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
export const previewTrainingProviderDelivery = onCall({ region: FUNCTIONS_MANIFEST.previewTrainingProviderDelivery.region }, handle(true));
export const mutateTrainingProviderDelivery = onCall({ region: FUNCTIONS_MANIFEST.mutateTrainingProviderDelivery.region }, handle(false));
