import { Timestamp } from 'firebase-admin/firestore';
import { parseTrainingScheduleSaveRequestV1, type CreatedWorkoutDeliveryOutcomeV1,
  type CreatedWorkoutDeliveryRequestV1, type TrainingScheduleSaveResponseV1 } from '../../../shared/training-workout-delivery-save';
import { TRAINING_DELIVERY_SETTINGS, deliverySettingsId, trainingDeliveryLocalDate,
  type TrainingDeliverySettingsV1 } from '../../../shared/training-provider-delivery';
import { TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID, type MutateTrainingScheduleRequestV1, type ScheduledWorkoutV1 } from '../../../shared/training-plans';
import { parseStrengthWorkoutDetailsV1, projectStrengthWorkoutToV1 } from '../../../shared/strength-workout';
import { hashTrainingScheduleRequestPayload, mutateTrainingScheduleForUser } from './persistence';
import { TrainingScheduleMutationError } from './mutation';
import { DELIVERY_LEDGER, DELIVERY_RECEIPTS, DELIVERY_SCOPES, DELIVERY_STATE, requiresDeliveryMappingApproval,
  type DeliveryRuntime } from './delivery/contracts';
import { deliveryIdentity } from './delivery/intent';
import { readSuuntoGuideOwnerPreferences } from './delivery/store';

/** Shares the authored transaction and existing reconciliation queue. No provider HTTP or browser follow-up. */
export async function createWorkoutWithDeliveryForUser(uid: string, raw: MutateTrainingScheduleRequestV1,
  delivery: CreatedWorkoutDeliveryRequestV1, runtime: DeliveryRuntime): Promise<TrainingScheduleSaveResponseV1> {
  const parsed = parseTrainingScheduleSaveRequestV1({ ...raw, deliveryAfterCreate: delivery });
  const request = parsed.request, intent = parsed.deliveryAfterCreate!;
  if (request.operation.kind !== 'create-workout') throw new TrainingScheduleMutationError('failed-precondition', 'Expected workout creation.');
  const operation = request.operation, now = runtime.now(), db = runtime.db, user = db.collection('users').doc(uid);
  const privateState = user.collection(DELIVERY_STATE).doc('current');
  const receipt = privateState.collection(DELIVERY_RECEIPTS).doc(`create_${hashTrainingScheduleRequestPayload(request.mutationId)}`);
  const authoredReceipt = user.collection('trainingPlanState').doc('current')
    .collection(TRAINING_PLAN_MUTATION_RECEIPTS_COLLECTION_ID).doc(request.mutationId);
  const hash = hashTrainingScheduleRequestPayload({ request, deliveryAfterCreate: intent });
  const strength = operation.strength ? parseStrengthWorkoutDetailsV1({ ...operation.strength, workoutId: operation.workoutId, revision: 1 }) : null;
  const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: operation.workoutId, planId: null, localDate: operation.localDate,
    title: operation.title, structure: strength ? projectStrengthWorkoutToV1(strength, operation.structure.sport) : operation.structure,
    lifecycle: 'planned', revision: 1, createdAtMs: now, updatedAtMs: now };
  const pro = await runtime.hasPro(uid);
  let outcomes: CreatedWorkoutDeliveryOutcomeV1[] = [], settings: TrainingDeliverySettingsV1[] = [], revision = 0, replay = false;
  const response = await mutateTrainingScheduleForUser(uid, request, { db, nowMs: now,
    additionalWriteBudget: intent.providers.length + 2, // Settings, private revision, and the compound receipt.
    transactionPrecondition: async tx => {
      // Reset retry-local preparation. Firestore may invoke this callback more than once.
      outcomes = []; settings = []; revision = 0; replay = false;
      const [previous, authored, state, scope] = await tx.getAll(receipt, authoredReceipt, privateState,
        user.collection(DELIVERY_SCOPES).doc(operation.workoutId));
      if (previous.exists) {
        if (previous.get('hash') !== hash) throw new TrainingScheduleMutationError('failed-precondition', 'This Add approval changed. Review it again.');
        const stored: unknown = previous.get('outcomes');
        if (!Array.isArray(stored) || stored.length !== intent.providers.length) {
          throw new TrainingScheduleMutationError('failed-precondition', 'The saved delivery approval is unavailable. Review sync.');
        }
        outcomes = intent.providers.map((provider, index) => {
          const value = stored[index];
          if (!value || typeof value !== 'object' || Array.isArray(value) || value.provider !== provider
            || !['queued', 'review-required', 'failed'].includes(value.state)
            || Object.keys(value).some(key => !['provider', 'state'].includes(key))) {
            throw new TrainingScheduleMutationError('failed-precondition', 'The saved delivery approval is unavailable. Review sync.');
          }
          return { provider, state: value.state };
        });
        replay = true; return;
      }
      // A plain Add receipt cannot later be upgraded into fresh provider consent.
      if (authored.exists) throw new TrainingScheduleMutationError('failed-precondition', 'This workout was already added without this delivery approval. Review its sync separately.');
      revision = state.get('revision') ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new TrainingScheduleMutationError('failed-precondition', 'Delivery settings are unavailable.');
      const generation = scope.get('generation') ?? 0;
      for (const provider of intent.providers) {
        const connection = await runtime.connection(tx, uid, provider);
        const [setting, retained] = await tx.getAll(
          user.collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId('workout', operation.workoutId, provider)),
          user.collection(DELIVERY_LEDGER).doc(deliveryIdentity(uid, provider, connection.destinationKey, operation.workoutId)));
        const transport = runtime.transport(provider, uid), today = trainingDeliveryLocalDate(now, intent.timeZone);
        const eligible = pro && transport && connection.state === 'connected' && !!connection.destinationKey
          && !setting.exists && !retained.exists && generation === 0 && workout.localDate >= today
          && (Date.parse(workout.localDate) - Date.parse(today)) / 86_400_000 <= transport.horizonDays;
        if (!eligible) { outcomes.push({ provider, state: 'review-required' }); continue; }
        const preferences = await readSuuntoGuideOwnerPreferences(tx, user, provider, [workout]);
        let canSend = false;
        try {
          const assessment = transport.assess(workout, connection.destinationKey, intent.timeZone, strength,
            strength ? preferences.unitSettings?.weightUnits : undefined, preferences.unitSettings, undefined, preferences.swimmingSettings);
          canSend = assessment.level !== 'unsupported' && !requiresDeliveryMappingApproval(assessment);
        } catch { outcomes.push({ provider, state: 'failed' }); continue; }
        if (!canSend) { outcomes.push({ provider, state: 'review-required' }); continue; }
        settings.push({ schemaVersion: 1, scope: 'workout', scopeId: operation.workoutId, provider,
          revision: ++revision, enabled: true, suppressed: false, timeZone: intent.timeZone,
          destinationKey: connection.destinationKey, connectionEpoch: connection.epoch,
          // Creation establishes the first scope generation in the same authoring transaction.
          scopeGeneration: generation + 1, associationPlanId: null, approvedDigest: null, updatedAtMs: now });
        outcomes.push({ provider, state: 'queued' });
      }
    },
    transactionPostcondition: tx => {
      if (replay) return; // A receipt replay must never undo a subsequent Stop, disconnect, edit or deletion.
      for (const setting of settings) tx.set(user.collection(TRAINING_DELIVERY_SETTINGS)
        .doc(deliverySettingsId('workout', operation.workoutId, setting.provider)), setting);
      if (settings.length) tx.set(privateState, { revision }, { merge: true });
      tx.create(receipt, { hash, outcomes, createdAtMs: now, expireAt: Timestamp.fromMillis(now + 30 * 86_400_000) });
      // The schedule transaction already stages this workout on the existing reconciliation queue.
    },
  });
  return { ...response, deliveryOutcomes: outcomes };
}
