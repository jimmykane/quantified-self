import { createHash } from 'node:crypto';
import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { TrainingDeliveryTransportError, type DeliveryArtifact, type DeliveryLedgerV1 } from '../contracts';

const MAX_GENERATION = 2_147_483_647;
export function wahooPlanGeneration(value: unknown = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_GENERATION) {
    throw new TrainingDeliveryTransportError('uncertain');
  }
  return Number(value);
}
export function wahooArtifactGeneration(artifact: DeliveryArtifact | null): number {
  const value = artifact?.ids.planGeneration;
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) throw new TrainingDeliveryTransportError('uncertain');
  return wahooPlanGeneration(Number(value));
}
export function wahooIdentities(destination: string, workoutId: string, generation = 0) {
  wahooPlanGeneration(generation);
  const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('base64url');
  const original = hash([destination, workoutId]);
  return { externalId: `qs-plan-${generation ? hash([destination, workoutId, generation]) : original}`,
    // Keep completion correlation stable; a new dated Workout is permissible only
    // after the previous pair's withdrawal has been durably acknowledged.
    workoutToken: `qs-workout-${original}`, ...(generation ? { planGeneration: String(generation) } : {}) };
}

/** Legacy Stop -> Send migration. Read a bounded, owner-local journal, not the
 * provider inventory. Only the most recent prior operation may prove withdrawal;
 * never skip an uncertain/newer upload to find an older convenient receipt. */
export async function recoverWahooWithdrawalGeneration(tx: Transaction, ref: DocumentReference,
  ledger: DeliveryLedgerV1): Promise<number | undefined> {
  if (ledger.provider !== 'wahoo' || ledger.wahooPlanGeneration !== undefined || ledger.actual || ledger.repair
    || (ledger.attempt && (ledger.attempt.kind !== 'upsert' || ledger.attempt.artifact !== null
      || ledger.attempt.progress !== null || ledger.attempt.recoveryBlocked))) return undefined;
  const history = await tx.get(ref.collection('attempts').orderBy('startedAtMs', 'desc').limit(25)
    .select('state', 'artifact', 'progress', 'startedAtMs', 'operation.id', 'operation.kind', 'operation.deliveryId',
      'operation.destinationKey', 'operation.artifact', 'operation.wahooPlanGeneration', 'operation.recoveryBlocked'));
  const prior = history.docs.filter(doc => doc.id !== ledger.attempt?.id);
  const latest = prior[0]?.data();
  // Millisecond ties have no causal ordering. Do not choose a random UUID winner.
  if (prior[1]?.data().startedAtMs === latest?.startedAtMs) return undefined;
  const operation = latest?.operation;
  const artifact = operation?.artifact as DeliveryArtifact | undefined;
  if (latest?.state !== 'accepted' || !Number.isSafeInteger(latest.startedAtMs) || latest.startedAtMs < 0
    || latest.artifact !== null || latest.progress?.version !== 1
    || latest.progress.step !== 'finished' || latest.progress.state !== 'accepted'
    || operation?.kind !== 'remove' || operation.id !== prior[0].id || operation.deliveryId !== ledger.id
    || operation.destinationKey !== ledger.destinationKey || operation.recoveryBlocked
    || !artifact?.ids || artifact.completed !== false
    || !/^[1-9]\d{0,18}$/.test(artifact.ids.plan) || !/^[1-9]\d{0,18}$/.test(artifact.ids.workout)
    || artifact.ids.association !== `${artifact.ids.workout}:${artifact.ids.plan}`) return undefined;
  try {
    const generation = wahooArtifactGeneration(artifact);
    if (operation.wahooPlanGeneration !== undefined && operation.wahooPlanGeneration !== generation) return undefined;
    const expected = wahooIdentities(ledger.destinationKey, ledger.workoutId, generation);
    if (artifact.ids.externalId !== expected.externalId || artifact.ids.workoutToken !== expected.workoutToken) return undefined;
    return wahooPlanGeneration(generation + 1);
  } catch { return undefined; }
}
