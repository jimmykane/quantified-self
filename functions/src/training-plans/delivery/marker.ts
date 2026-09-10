import { createHash } from 'node:crypto';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../../shared/planned-workout-providers';
import { deliverySettingsId, TRAINING_DELIVERY_SETTINGS } from '../../../../shared/training-provider-delivery';
import { DELIVERY_QUEUE, DELIVERY_SCOPES, DELIVERY_STATE } from './contracts';

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
