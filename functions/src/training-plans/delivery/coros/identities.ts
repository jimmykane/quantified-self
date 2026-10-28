import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { createStableProviderIntegerId } from '../../providers/provider-mapping';
import { TrainingDeliveryTransportError } from '../contracts';

const MAX_COLLISION_PROBES = 32;
export const COROS_INTEGER_CLAIMS = 'trainingDeliveryCorosIntegerClaims';

interface CorosIntegerIdentityV1 {
  schemaVersion: 1;
  provider: 'coros';
  kind: 'athlete' | 'workout';
  bindingDigest: string;
  integerId: number;
  destinationKey: string | null;
  workoutId: string | null;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mappingId(kind: CorosIntegerIdentityV1['kind'], bindingDigest: string): string {
  return `${kind}_${bindingDigest}`;
}

export function corosIntegerCandidate(kind: CorosIntegerIdentityV1['kind'], bindingDigest: string, probe: number): number {
  if (!/^[a-f0-9]{64}$/.test(bindingDigest) || !Number.isInteger(probe) || probe < 0 || probe >= MAX_COLLISION_PROBES) {
    throw new TrainingDeliveryTransportError('terminal');
  }
  return createStableProviderIntegerId('coros', `${kind}:${bindingDigest}:${probe}`);
}

function parseIdentity(value: unknown, expected: Pick<CorosIntegerIdentityV1, 'kind' | 'bindingDigest'>): CorosIntegerIdentityV1 {
  const record = value as Partial<CorosIntegerIdentityV1> | null;
  if (!record || record.schemaVersion !== 1 || record.provider !== 'coros' || record.kind !== expected.kind
    || record.bindingDigest !== expected.bindingDigest || !Number.isSafeInteger(record.integerId)
    || record.integerId! <= 0 || record.integerId! > 2_147_483_647
    || !(record.destinationKey === null || typeof record.destinationKey === 'string')
    || !(record.workoutId === null || typeof record.workoutId === 'string')) {
    throw new TrainingDeliveryTransportError('uncertain');
  }
  return record as CorosIntegerIdentityV1;
}

/** Reserves collision-checked partner integers inside the caller's delivery-claim
 * transaction. Stable mappings live under the user's recursively deleted private
 * state; the private partner-wide claim registry prevents cross-user collisions. */
export async function reserveCorosIntegerIdentities(
  db: Firestore,
  tx: Transaction,
  uid: string,
  destinationKey: string,
  workoutIds: readonly string[],
): Promise<ReadonlyMap<string, Readonly<Record<string, string | number>>>> {
  if (!uid || !destinationKey || workoutIds.length < 1 || workoutIds.length > 30
    || new Set(workoutIds).size !== workoutIds.length) throw new TrainingDeliveryTransportError('terminal');
  const state = db.collection('users').doc(uid).collection('trainingDeliveryState').doc('current');
  const mappings = state.collection('corosIntegerIdentities');
  const claims = db.collection(COROS_INTEGER_CLAIMS);
  const requested = [
    { kind: 'athlete' as const, bindingDigest: digest(['coros-athlete', uid]), destinationKey: null, workoutId: null },
    ...workoutIds.map(workoutId => ({ kind: 'workout' as const,
      bindingDigest: digest(['coros-workout', destinationKey, workoutId]), destinationKey, workoutId })),
  ];
  const mappingSnapshots = await Promise.all(requested.map(item => tx.get(mappings.doc(mappingId(item.kind, item.bindingDigest)))));
  const resolved = new Map<string, CorosIntegerIdentityV1>();
  const locallyClaimed = new Map<number, string>();

  for (let index = 0; index < requested.length; index++) {
    const item = requested[index];
    const snapshot = mappingSnapshots[index];
    if (!snapshot.exists) continue;
    const identity = parseIdentity(snapshot.data(), item);
    if (identity.destinationKey !== item.destinationKey || identity.workoutId !== item.workoutId) {
      throw new TrainingDeliveryTransportError('uncertain');
    }
    const claim = await tx.get(claims.doc(String(identity.integerId)));
    if (!claim.exists || claim.data()?.schemaVersion !== 1 || claim.data()?.provider !== 'coros'
      || claim.data()?.uid !== uid || claim.data()?.bindingDigest !== item.bindingDigest
      || claim.data()?.kind !== item.kind || claim.data()?.integerId !== identity.integerId) {
      throw new TrainingDeliveryTransportError('uncertain');
    }
    resolved.set(item.bindingDigest, identity);
    locallyClaimed.set(identity.integerId, item.bindingDigest);
  }

  for (const item of requested) {
    if (resolved.has(item.bindingDigest)) continue;
    let selected = 0;
    for (let probe = 0; probe < MAX_COLLISION_PROBES; probe++) {
      const candidate = corosIntegerCandidate(item.kind, item.bindingDigest, probe);
      const local = locallyClaimed.get(candidate);
      if (local && local !== item.bindingDigest) continue;
      const claim = await tx.get(claims.doc(String(candidate)));
      if (!claim.exists || (claim.data()?.schemaVersion === 1 && claim.data()?.provider === 'coros'
        && claim.data()?.uid === uid && claim.data()?.bindingDigest === item.bindingDigest
        && claim.data()?.kind === item.kind && claim.data()?.integerId === candidate)) {
        selected = candidate;
        break;
      }
    }
    if (!selected) throw new TrainingDeliveryTransportError('terminal');
    const identity: CorosIntegerIdentityV1 = { schemaVersion: 1, provider: 'coros', kind: item.kind,
      bindingDigest: item.bindingDigest, integerId: selected, destinationKey: item.destinationKey, workoutId: item.workoutId };
    resolved.set(item.bindingDigest, identity);
    locallyClaimed.set(selected, item.bindingDigest);
  }

  for (let index = 0; index < requested.length; index++) {
    const item = requested[index];
    if (mappingSnapshots[index].exists) continue;
    const identity = resolved.get(item.bindingDigest)!;
    tx.create(mappings.doc(mappingId(item.kind, item.bindingDigest)), identity);
    // The transaction read makes this collision-safe. `set` also repairs the
    // bounded case where account cleanup removed the user mapping before a
    // matching global claim, without allocating a different provider ID.
    tx.set(claims.doc(String(identity.integerId)), {
      schemaVersion: 1, provider: 'coros', kind: identity.kind,
      uid, bindingDigest: identity.bindingDigest, integerId: identity.integerId,
    });
  }

  const athleteId = resolved.get(requested[0].bindingDigest)!.integerId;
  return new Map(requested.slice(1).map(item => [item.workoutId!, {
    athleteId,
    workoutId: resolved.get(item.bindingDigest)!.integerId,
  }]));
}
