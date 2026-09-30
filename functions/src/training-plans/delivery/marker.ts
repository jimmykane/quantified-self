import { createHash } from 'node:crypto';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../../shared/planned-workout-providers';
import { deliverySettingsId, TRAINING_DELIVERY_SETTINGS } from '../../../../shared/training-provider-delivery';
import { DELIVERY_QUEUE, DELIVERY_SCOPES, DELIVERY_STATE } from './contracts';
import type { DeliveryLedgerV1, PastCleanupAuthorization } from './contracts';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';

const PAST_CLEANUP = 'pastCleanup';

function pastCleanupRef(db: Firestore, uid: string, scope: 'plan' | 'workout', scopeId: string) {
  return db.collection('users').doc(uid).collection(DELIVERY_STATE).doc('current')
    .collection(PAST_CLEANUP).doc(`${scope}_${scopeId}`);
}

/** These server-only intents survive authored-source deletion; no provider request runs in the mutation transaction. */
export function stagePastPlanCleanup(tx: Transaction, db: Firestore, uid: string, planId: string,
  workoutIds: readonly string[], mutationId: string, requestedAtMs: number): void {
  tx.create(pastCleanupRef(db, uid, 'plan', planId), {
    schemaVersion: 1, scope: 'plan', scopeId: planId, mutationId, requestedAtMs,
    workoutIds: [...workoutIds].sort(),
  });
}

export function stagePastWorkoutCleanup(tx: Transaction, db: Firestore, uid: string, workoutId: string,
  mutationId: string, requestedAtMs: number, enabled: boolean, deletedAtMs?: number): void {
  tx.set(pastCleanupRef(db, uid, 'workout', workoutId), {
    schemaVersion: 1, scope: 'workout', scopeId: workoutId, mutationId, requestedAtMs, enabled,
    ...(deletedAtMs === undefined ? {} : { deletedAtMs }),
  });
}

function stillDeleted(authorization: PastCleanupAuthorization, workout: ScheduledWorkoutV1 | null): boolean {
  if (authorization.scope === 'plan') return !workout || workout.planId !== authorization.scopeId;
  return !workout || (workout.lifecycle === 'deleted' && workout.deletedAtMs === authorization.deletedAtMs);
}

export async function readPastCleanupAuthorization(tx: Transaction, db: Firestore, uid: string,
  ledger: DeliveryLedgerV1 | null, workout: ScheduledWorkoutV1 | null): Promise<PastCleanupAuthorization | null> {
  if (!ledger?.actual && !ledger?.repair?.original) return null;
  if (workout?.lifecycle === 'deleted' || !workout) {
    const snapshot = await tx.get(pastCleanupRef(db, uid, 'workout', ledger.workoutId));
    const value = snapshot.data();
    if (value?.schemaVersion === 1 && typeof value.enabled === 'boolean'
      && value.scope === 'workout' && value.scopeId === ledger.workoutId
      && typeof value.mutationId === 'string' && Number.isSafeInteger(value.requestedAtMs)
      && (workout ? value.deletedAtMs === workout.deletedAtMs : true)) {
      // The later per-workout deletion choice supersedes an earlier plan opt-in.
      if (!value.enabled) return null;
      return { scope: 'workout', scopeId: ledger.workoutId, mutationId: value.mutationId,
        requestedAtMs: value.requestedAtMs, ...(Number.isSafeInteger(value.deletedAtMs) ? { deletedAtMs: value.deletedAtMs } : {}) };
    }
  }
  // A plan-to-standalone deletion can clear the ledger's current planId while a
  // disconnected provider is still holding its old copy. Retain only a pointer
  // here; the private marker remains the authority for every retry.
  const deletedPlanId = ledger.pastCleanup?.scope === 'plan' ? ledger.pastCleanup.scopeId : ledger.planId;
  if (deletedPlanId && stillDeleted({ scope: 'plan', scopeId: deletedPlanId, mutationId: '', requestedAtMs: 0 }, workout)) {
    const snapshot = await tx.get(pastCleanupRef(db, uid, 'plan', deletedPlanId));
    const value = snapshot.data();
    if (value?.schemaVersion === 1 && value.scope === 'plan' && value.scopeId === deletedPlanId
      && typeof value.mutationId === 'string' && Number.isSafeInteger(value.requestedAtMs)
      && (ledger.pastCleanup?.scope !== 'plan' || ledger.pastCleanup.mutationId === value.mutationId)
      && Array.isArray(value.workoutIds) && value.workoutIds.includes(ledger.workoutId)) {
      return { scope: 'plan', scopeId: deletedPlanId, mutationId: value.mutationId, requestedAtMs: value.requestedAtMs };
    }
  }
  return null;
}

export function reconciliationJobId(uid: string): string {
  return `reconcile_${createHash('sha256').update(uid).digest('hex')}`;
}
/** Write-only transactional outbox; never assembles provider payloads in an authoring transaction. */
export function stageTrainingDeliveryReconciliation(tx: Transaction, db: Firestore, uid: string): void {
  tx.set(db.collection(DELIVERY_QUEUE).doc(reconciliationJobId(uid)), {
    uid, kind: 'reconcile', generation: FieldValue.increment(1), dueAtMs: 0,
  }, { merge: true });
}
export function invalidateTrainingWorkoutConsent(tx: Transaction, db: Firestore, uid: string, workoutId: string): void {
  tx.set(db.collection('users').doc(uid).collection(DELIVERY_SCOPES).doc(workoutId), {
    generation: FieldValue.increment(1),
  }, { merge: true });
}
export function retireTrainingPlanDeliverySettings(tx: Transaction, db: Firestore, uid: string, planId: string): void {
  // Settings are leaf documents by contract (all browser descendants are denied).
  // Keep artifact/attempt trees in the independent ledger so withdrawals can finish.
  for (const provider of PLANNED_WORKOUT_PROVIDER_IDS) {
    tx.delete(db.collection('users').doc(uid).collection(TRAINING_DELIVERY_SETTINGS).doc(deliverySettingsId('plan', planId, provider)));
  }
}
export function stageTrainingDeliveryDisconnect(tx: Transaction, db: Firestore, uid: string, provider: string): void {
  tx.set(db.collection('users').doc(uid).collection(DELIVERY_STATE).doc('current'), {
    connectionEpochs: { [provider]: FieldValue.increment(1) },
  }, { merge: true });
  stageTrainingDeliveryReconciliation(tx, db, uid);
}

export function stageTrainingDeliveryServiceDisconnect(tx: Transaction, db: Firestore, uid: string, service: ServiceNames): void {
  const provider = service === ServiceNames.GarminAPI ? 'garmin' : service === ServiceNames.COROSAPI ? 'coros'
    : service === ServiceNames.SuuntoApp ? 'suunto' : service === ServiceNames.WahooAPI ? 'wahoo' : null;
  if (provider) stageTrainingDeliveryDisconnect(tx, db, uid, provider);
}
