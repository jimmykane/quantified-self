import { randomUUID } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { deliverySettingsId } from '../../../../shared/training-provider-delivery';
import { DELIVERY_QUEUE, DELIVERY_STATE, type DeliveryContext, type DeliveryLedgerV1, type DeliveryRuntime } from './contracts';
import { VERIFICATION_DAY_MS, type VerificationEvidence } from './verification-contracts';

export function emptyVerification(now: number): VerificationEvidence {
  return { binding: '', state: 'pending', missing: false, missingKeys: [], suspectedAtMs: null,
    checkedAtMs: null, nextCheckAtMs: now, requestedAtMs: 0, manualPending: false, cursor: null, repairTimes: [] };
}
export async function readVerificationRequest(runtime: DeliveryRuntime, tx: Transaction, uid: string,
  record: DeliveryLedgerV1): Promise<number> {
  const checks = runtime.db.collection('users').doc(uid).collection(DELIVERY_STATE).doc('current').collection('checks');
  const rows = await Promise.all([
    tx.get(checks.doc(deliverySettingsId('workout', record.workoutId, record.provider))),
    record.planId ? tx.get(checks.doc(deliverySettingsId('plan', record.planId, record.provider))) : null,
  ]);
  return Math.max(0, ...rows.map(row => row?.data()?.requestedAtMs ?? 0));
}

/** Single enqueue path for periodic checks, manual requests and future authenticated hints.
 * Delivery work is staged first by the caller; a verification must never overwrite it. */
export function stageVerification(runtime: DeliveryRuntime, tx: Transaction, uid: string,
  record: DeliveryLedgerV1, context: DeliveryContext, requestedAtMs: number): void {
  const manualRequested = requestedAtMs > (record.verification?.requestedAtMs ?? 0);
  if (!record.actual || record.attempt || record.desired !== 'present'
    || (record.status !== 'delivered' && !(record.status === 'pending' && record.verification?.missing)
      && !(record.status === 'needs_attention' && manualRequested))) return;
  const inspection = context.transport?.inspection;
  const evidence = record.verification ?? emptyVerification(runtime.now());
  if (!inspection || inspection.policy.mode === 'unavailable') {
    record.verification = { ...evidence, state: 'unsupported', nextCheckAtMs: runtime.now() + VERIFICATION_DAY_MS };
    return;
  }
  const manual = requestedAtMs > evidence.requestedAtMs;
  if (manual) {
    evidence.manualPending = true;
    evidence.requestedAtMs = requestedAtMs;
    evidence.nextCheckAtMs = Math.max(runtime.now(), record.providerNotBeforeMs ?? 0);
    evidence.state = evidence.nextCheckAtMs > runtime.now() ? 'deferred' : 'pending';
  }
  record.verification = evidence;
  if (evidence.nextCheckAtMs > runtime.now() && !manual) return;
  tx.set(runtime.db.collection(DELIVERY_QUEUE).doc(record.id), { uid, deliveryId: record.id,
    kind: 'verification', priority: evidence.manualPending ? 'manual' : 'ordinary',
    dueAtMs: Math.max(evidence.nextCheckAtMs, record.lease?.expiresAtMs ?? 0), dispatchToken: randomUUID() });
}
