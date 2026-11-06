import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { parseTrainingDeliveryStatusV1, parseTrainingDeliverySettingsV1, deliverySettingsId,
  trainingDeliveryLocalDate } from '../../../shared/training-provider-delivery';
import { isTrainingProviderDeliveryEnabled } from '../../../shared/training-delivery-rollout';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { createHash } from 'node:crypto';
import { normalizeTrainingLocalDate } from '../../../shared/training-plans';

const services = { garmin: ServiceNames.GarminAPI, coros: ServiceNames.COROSAPI,
  suunto: ServiceNames.SuuntoApp, wahoo: ServiceNames.WahooAPI } as const;

export const TRAINING_PUSH = { groupMs: 120000, cooldownMs: 3600000, dayMs: 86400000,
  dailyLimit: 2, batchLimit: 25, deviceLimit: 10, batchExpiryMs: 600000, sweepLimit: 25 } as const;
export const trainingAttention = (status: unknown) => ['failed', 'needs_attention', 'reconnect_required', 'connection_repair'].includes(String(status));
export const trainingRecovered = (status: unknown) => status === 'delivered';
export const trainingIssuePath = (uid: string, id: string) => `users/${uid}/pushState/trainingSync/issues/${id}`;
export interface TrainingCandidate { id: string; observedAt: number; status: string; }
export interface TrainingEntry extends TrainingCandidate {
  episode: string; issueId: string; desiredGeneration: number; settingsRevision: number; connectionGeneration: string;
  destinationKey: string; workoutUpdatedAt: number; consentUpdatedAt: number;
}
const entityId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** Status is only a signal. Recheck the current authored scope, consent and private generation, without provider I/O. */
export async function currentTrainingEntry(db: Firestore, tx: Transaction, uid: string, candidate: TrainingCandidate,
  now: number): Promise<Omit<TrainingEntry, 'episode'> | null> {
  if (!/^[a-f0-9]{64}$/.test(candidate.id) || !Number.isSafeInteger(candidate.observedAt)
    || candidate.observedAt <= 0 || candidate.observedAt > now || now - candidate.observedAt > TRAINING_PUSH.dayMs) return null;
  const root = `users/${uid}`;
  const [statusDoc, ledgers] = await Promise.all([
    tx.get(db.doc(`${root}/trainingDeliveryStatuses/${candidate.id}`)),
    tx.getAll(db.doc(`${root}/trainingDeliveryLedger/${candidate.id}`), { fieldMask: ['id', 'workoutId', 'planId', 'provider',
      'status', 'desiredGeneration', 'settingsRevision', 'destinationKey', 'connectionEpoch', 'updatedAtMs'] }),
  ]);
  let status: ReturnType<typeof parseTrainingDeliveryStatusV1>;
  try { status = parseTrainingDeliveryStatusV1(statusDoc.data()); } catch { return null; }
  const ledger = ledgers[0].data();
  if (!ledger || status.id !== candidate.id || !entityId(status.workoutId) || status.planId !== null && !entityId(status.planId)
    || !trainingAttention(status.status) || status.updatedAtMs < candidate.observedAt || status.updatedAtMs > now
    || !isTrainingProviderDeliveryEnabled(status.provider, uid) || ledger.id !== status.id || ledger.status !== status.status
    || ledger.workoutId !== status.workoutId || ledger.planId !== status.planId || ledger.provider !== status.provider
    || ledger.updatedAtMs !== status.updatedAtMs || !Number.isSafeInteger(ledger.desiredGeneration) || ledger.desiredGeneration < 1
    || !Number.isSafeInteger(ledger.settingsRevision) || typeof ledger.destinationKey !== 'string' || !ledger.destinationKey) return null;
  const scope = status.planId ? 'plan' : 'workout', scopeId = status.planId ?? status.workoutId;
  const [workouts, settingDoc, overrideDoc, scopeDoc, stateDoc, metaDoc, planDoc, locks] = await Promise.all([
    tx.getAll(db.doc(`${root}/scheduledWorkouts/${status.workoutId}`), { fieldMask: ['id', 'planId', 'localDate', 'lifecycle', 'updatedAtMs'] }),
    tx.get(db.doc(`${root}/trainingDeliverySettings/${deliverySettingsId(scope, scopeId, status.provider)}`)),
    tx.get(db.doc(`${root}/trainingDeliverySettings/${deliverySettingsId('workout', status.workoutId, status.provider)}`)),
    tx.get(db.doc(`${root}/trainingDeliveryScopes/${status.workoutId}`)),
    tx.get(db.doc(`${root}/trainingDeliveryState/current`)),
    tx.get(db.doc(`${root}/meta/${services[status.provider]}`)),
    status.planId ? tx.get(db.doc(`${root}/trainingPlans/${status.planId}`)) : null,
    tx.get(db.collection(`${root}/trainingPlanState/current/planDeletionLocks`).limit(1)),
  ]);
  let setting: ReturnType<typeof parseTrainingDeliverySettingsV1>;
  let override: ReturnType<typeof parseTrainingDeliverySettingsV1> | null;
  try {
    setting = parseTrainingDeliverySettingsV1(settingDoc.data());
    override = overrideDoc.exists ? parseTrainingDeliverySettingsV1(overrideDoc.data()) : null;
  } catch { return null; }
  const workout = workouts[0].data(), meta = metaDoc.data(), plan = planDoc?.data();
  if (override && (override.scope !== 'workout' || override.scopeId !== status.workoutId || override.provider !== status.provider)) return null;
  const currentOverride = override?.scopeGeneration === (scopeDoc.data()?.generation ?? 0)
    && override?.associationPlanId === status.planId ? override : null;
  if (!setting.enabled || setting.suppressed || setting.scope !== scope || setting.scopeId !== scopeId
    || setting.provider !== status.provider || setting.destinationKey !== ledger.destinationKey
    || setting.connectionEpoch !== ledger.connectionEpoch
    || setting.connectionEpoch !== (stateDoc.data()?.connectionEpochs?.[status.provider] ?? 0)
    || scope === 'workout' && (!currentOverride || currentOverride !== override)
    || currentOverride?.suppressed || ledger.settingsRevision !== Math.max(setting.revision, currentOverride?.revision ?? 0)
    || !workout || workout.id !== status.workoutId || workout.planId !== status.planId || workout.lifecycle !== 'planned'
    || !Number.isSafeInteger(workout.updatedAtMs) || workout.updatedAtMs > status.updatedAtMs || setting.updatedAtMs > status.updatedAtMs
    || (currentOverride?.updatedAtMs ?? 0) > status.updatedAtMs
    || status.planId && (!plan || plan.lifecycle !== 'active' || plan.updatedAtMs > status.updatedAtMs)
    || !locks.empty || !stateDoc.exists || !meta || !['connected', 'reconnect_required'].includes(meta.connectionState)
    || typeof meta.connectionStateGeneration !== 'string' || !meta.connectionStateGeneration
    || typeof meta.providerUserId !== 'string' || !meta.providerUserId) return null;
  // Same framing as deliveryIdentity(uid, provider, account, 'account'). This metadata
  // pin only cancels stale-account alerts; it never authorizes provider requests.
  if (createHash('sha256').update(JSON.stringify([uid, status.provider, meta.providerUserId, 'account'])).digest('hex') !== ledger.destinationKey) return null;
  try { if (normalizeTrainingLocalDate(workout.localDate) < trainingDeliveryLocalDate(now, setting.timeZone)) return null; }
  catch { return null; }
  const issueId = ['reconnect_required', 'connection_repair'].includes(status.status)
    ? createHash('sha256').update(JSON.stringify([status.provider, ledger.destinationKey, meta.connectionStateGeneration, 'connection'])).digest('hex')
    : candidate.id;
  const entry = { ...candidate, issueId, desiredGeneration: ledger.desiredGeneration, settingsRevision: ledger.settingsRevision,
    connectionGeneration: meta.connectionStateGeneration, destinationKey: ledger.destinationKey, workoutUpdatedAt: workout.updatedAtMs,
    consentUpdatedAt: Math.max(setting.updatedAtMs, currentOverride?.updatedAtMs ?? 0) };
  const previous = candidate as Partial<TrainingEntry>;
  if (previous.desiredGeneration !== undefined && ['issueId', 'desiredGeneration', 'settingsRevision', 'connectionGeneration', 'destinationKey', 'workoutUpdatedAt', 'consentUpdatedAt']
    .some(key => previous[key as keyof TrainingEntry] !== entry[key as keyof typeof entry])) return null;
  return entry;
}
