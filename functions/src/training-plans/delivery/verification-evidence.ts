import { hashTrainingScheduleRequestPayload } from '../persistence';
import type { DeliveryContext, DeliveryLedgerV1 } from './contracts';
import { VERIFICATION_DAY_MS, type InspectionObservation, type InspectionPolicy, type VerificationEvidence } from './verification-contracts';

export function inspectionBinding(ledger: DeliveryLedgerV1, context: DeliveryContext, policy: InspectionPolicy): string {
  return hashTrainingScheduleRequestPayload({ destination: ledger.destinationKey, epoch: context.connection.epoch,
    connection: context.connection.generation, artifact: ledger.actual, policy,
    desired: ledger.desiredDigest, scopeGeneration: context.scopeGeneration,
    settings: context.setting, override: context.override });
}
export function observeInspection(previous: VerificationEvidence | undefined, binding: string,
  policy: InspectionPolicy, observation: InspectionObservation, now: number): VerificationEvidence {
  const same = previous?.binding === binding;
  const result: VerificationEvidence = {
    binding, state: 'unknown', missing: previous?.missing ?? false, missingKeys: same ? previous.missingKeys : [],
    suspectedAtMs: null, checkedAtMs: now, nextCheckAtMs: now + VERIFICATION_DAY_MS,
    requestedAtMs: previous?.requestedAtMs ?? 0, manualPending: false, cursor: null,
    repairTimes: (previous?.repairTimes ?? []).filter(time => time > now - VERIFICATION_DAY_MS),
  };
  if (policy.mode === 'unavailable') return { ...result, state: 'unsupported' };
  if (!observation || typeof observation.conflict !== 'boolean' || !Array.isArray(observation.artifacts)
    || observation.artifacts.length > 16 || observation.artifacts.some(item => !item
      || typeof item.key !== 'string' || !['present', 'absent', 'unknown'].includes(item.state)
      || typeof item.authoritative !== 'boolean')) return result;
  const keys = observation.artifacts.map(item => item.key);
  if (observation.conflict || keys.length !== new Set(keys).size
    || policy.required.some(key => !keys.includes(key)) || keys.some(key => !policy.required.includes(key))) return result;
  const allPresent = observation.artifacts.length > 0 && observation.artifacts.every(item => item.state === 'present' && item.authoritative);
  if (allPresent) return { ...result, state: 'present', missing: false, missingKeys: [] };
  const coverage = observation.coverage;
  if (policy.mode === 'inventory' && (coverage?.complete !== true || coverage.stable !== true || coverage.filtered !== false || coverage.nextCursor !== null)) {
    // Pages are not independent absence observations. Preserve the first completed
    // scan's negative through a stable second scan, but never confirm from a page.
    const cursor = coverage?.stable === true && coverage.filtered === false && typeof coverage.nextCursor === 'string'
      && coverage.nextCursor.length > 0 && coverage.nextCursor.length <= 1024 && coverage.nextCursor !== previous?.cursor ? coverage.nextCursor : null;
    const positive = observation.artifacts.some(item => item.state === 'present' && previous?.missingKeys.includes(item.key));
    return { ...result, cursor, suspectedAtMs: same && cursor && !positive ? previous.suspectedAtMs : null,
      manualPending: !!cursor && (previous?.manualPending ?? false) };
  }
  if (!policy.authoritativeAbsence || observation.artifacts.some(item => item.state === 'unknown'
    || !item.authoritative)) return result;
  const missing = observation.artifacts.filter(item => item.state === 'absent').map(item => item.key).sort();
  if (!missing.length) return result;
  const continuing = same && previous.suspectedAtMs !== null && JSON.stringify(previous.missingKeys) === JSON.stringify(missing);
  const since = continuing ? previous.suspectedAtMs! : now;
  const confirmed = continuing && now - since >= policy.confirmationDelayMs;
  return { ...result, state: confirmed ? 'confirmed_missing' : 'suspected_missing', missing: confirmed || result.missing,
    missingKeys: missing, suspectedAtMs: since, nextCheckAtMs: confirmed ? now + VERIFICATION_DAY_MS : since + policy.confirmationDelayMs };
}
