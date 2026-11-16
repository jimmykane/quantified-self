import * as logger from 'firebase-functions/logger';
import type { Transaction } from 'firebase-admin/firestore';
import type { ScheduledWorkoutV1 } from '../../../shared/training-plans';
import type { StrengthWorkoutDetailsV1 } from '../../../shared/strength-workout';
import { notificationPreferencePath, readNotificationCategoryPreference } from '../../../shared/notification-categories';
import { isAutomaticPushOrigin, isPushId, isPushRegistration, WEB_PUSH_ORIGINS } from '../../../shared/web-push';
import { deliverySettingsId, trainingDeliveryLocalDate, type TrainingDeliveryCommandV1, type TrainingDeliverySettingsV1 } from '../../../shared/training-provider-delivery';
import type { DeliveryConnection, DeliveryRuntime, TrainingDeliveryTransport } from '../training-plans/delivery/contracts';
import { deliveryContentDigest, deliveryIdentity } from '../training-plans/delivery/intent';
import { automaticPushConfiguration } from './history-consent';
import { TRAINING_SEND, trainingSendId, type TrainingSendState, type TrainingSendMember } from './training-send-policy';

/** Optional runtime hook: no notification configuration enters the public command or MCP contract. */
export async function trainingSendConfiguration(): Promise<{ enabled: boolean; publicKey: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([automaticPushConfiguration('web_push_training_sync_enabled'), new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Training notification configuration timed out.')), 5000);
  })]); }
  catch { logger.error('[TrainingSendPush]', { telemetryVersion: 1, phase: 'admission', outcome: 'failed' });
    return { enabled: false, publicKey: '' }; }
  finally { if (timer) clearTimeout(timer); }
}

/** Read-only preparation inside the user's existing guarded confirmation transaction. */
export async function prepareTrainingSend(runtime: DeliveryRuntime, tx: Transaction, uid: string,
  command: Pick<TrainingDeliveryCommandV1, 'action' | 'scope' | 'scopeId' | 'provider' | 'mutationId'>,
  previous: TrainingDeliverySettingsV1 | null, setting: TrainingDeliverySettingsV1,
  planSetting: TrainingDeliverySettingsV1 | null, workouts: readonly ScheduledWorkoutV1[],
  strengths: readonly (StrengthWorkoutDetailsV1 | null)[], connection: DeliveryConnection,
  transport: TrainingDeliveryTransport | null, config: { enabled: boolean; publicKey: string } | undefined) {
  const requested = command.action === 'send' || command.action === 'retry'
    || command.action === 'configure' && !previous?.enabled;
  if (!requested || !config?.enabled || !transport || setting.suppressed
    || !(command.scope === 'workout' && workouts[0]?.planId ? planSetting?.enabled : setting.enabled)) return null;
  const { db } = runtime, now = runtime.now(), user = db.collection('users').doc(uid);
  const today = trainingDeliveryLocalDate(now, setting.timeZone);
  const eligible = workouts.flatMap((workout, index) => workout.lifecycle === 'planned' && workout.localDate >= today
    && (Date.parse(workout.localDate) - Date.parse(today)) / 86400000 <= transport.horizonDays ? [{ workout, strength: strengths[index] }] : []);
  if (!eligible.length) return null;
  const preference = readNotificationCategoryPreference((await tx.get(db.doc(notificationPreferencePath(uid, 'training_send')))).data());
  if (!preference?.enabled) return null;
  const devices = await tx.get(user.collection('pushSubscriptions').where('origin', 'in', [...WEB_PUSH_ORIGINS]).limit(TRAINING_SEND.deviceLimit));
  const targets = devices.docs.flatMap(doc => {
    const registration = doc.data();
    return isPushId(doc.id) && isPushRegistration(registration) && isAutomaticPushOrigin(registration.origin)
      && registration.vapidPublicKey === config.publicKey ? [{ id: doc.id, generation: registration.generation, origin: registration.origin }] : [];
  });
  if (!targets.length) return null;
  const members: Record<string, TrainingSendMember> = {};
  const snapshots = await tx.getAll(...eligible.flatMap(({ workout }) => [
    user.collection('trainingDeliveryLedger').doc(deliveryIdentity(uid, command.provider, connection.destinationKey, workout.id)),
    user.collection('trainingWorkoutCompletions').doc(workout.id),
    user.collection('trainingDeliverySettings').doc(deliverySettingsId('workout', workout.id, command.provider)),
  ]), { fieldMask: ['status', 'acceptedContentDigest', 'actual.ids', 'verification.missing', 'suppressed', 'associationPlanId', 'scopeGeneration'] });
  for (const [index, { workout, strength }] of eligible.entries()) {
    const id = deliveryIdentity(uid, command.provider, connection.destinationKey, workout.id);
    const [ledger, completion, override] = snapshots.slice(index * 3, index * 3 + 3);
    if (completion.exists) continue;
    if (command.scope === 'plan' && override.get('suppressed') === true && override.get('associationPlanId') === workout.planId) {
      const scope = await tx.get(user.collection('trainingDeliveryScopes').doc(workout.id));
      if ((scope.get('generation') ?? 0) === override.get('scopeGeneration')) continue;
    }
    const digest = deliveryContentDigest(workout, setting.timeZone, strength);
    if (!digest || ledger.get('status') === 'delivered' && ledger.get('acceptedContentDigest') === digest && ledger.get('actual.ids')
      && ledger.get('verification.missing') !== true) continue;
    members[id] = { workoutId: workout.id, planId: workout.planId, updatedAt: workout.updatedAtMs,
      contentDigest: digest, result: 'waiting', observedAt: 0 };
  }
  if (!Object.keys(members).length || Object.keys(members).length > TRAINING_SEND.memberLimit) return null;
  const state: TrainingSendState = { schemaVersion: 1, requestId: command.mutationId, scope: command.scope, scopeId: command.scopeId,
    planId: command.scope === 'plan' ? command.scopeId : workouts[0]?.planId ?? null, total: Object.keys(members).length, unchanged: 0,
    provider: command.provider, settingsRevision: setting.revision, destinationKey: connection.destinationKey, connectionEpoch: connection.epoch,
    categoryRevision: preference.revision, createdAt: now, members, targets, remaining: Object.keys(members).length, sent: 0, failed: 0 };
  return { ref: user.collection('pushState').doc(trainingSendId(command.scope, command.scopeId, command.provider)), state };
}
