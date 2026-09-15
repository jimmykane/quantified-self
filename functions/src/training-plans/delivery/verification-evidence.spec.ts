import { describe, expect, it } from 'vitest';
import { observeInspection } from './verification-evidence';
import type { InspectionObservation, InspectionPolicy } from './verification-contracts';

const policy: InspectionPolicy = { version: 'proof-v1', mode: 'retained-ids', required: ['workout', 'schedule'],
  confirmationDelayMs: 900_000, authoritativeAbsence: true, repairReady: true };
const missing: InspectionObservation = { conflict: false, artifacts: [
  { key: 'workout', state: 'present', authoritative: true }, { key: 'schedule', state: 'absent', authoritative: true }] };
describe('provider-neutral inspection evidence', () => {
  it('requires two spaced negatives bound to the exact authority', () => {
    const first = observeInspection(undefined, 'authority', policy, missing, 1000);
    expect(first.state).toBe('suspected_missing');
    expect(observeInspection(first, 'authority', policy, missing, 900_999).missing).toBe(false);
    expect(observeInspection(first, 'authority', policy, missing, 901_000).state).toBe('confirmed_missing');
    expect(observeInspection(first, 'other-connection', policy, missing, 901_000).state).toBe('suspected_missing');
  });
  it('resets the confirmation chain on a positive or inconclusive observation', () => {
    const first = observeInspection(undefined, 'a', policy, missing, 1000);
    for (const observation of [{ ...missing, conflict: true }, { ...missing, artifacts: missing.artifacts.map(item => ({ ...item, state: 'present' as const })) }]) {
      const intervening = observeInspection(first, 'a', policy, observation, 5000);
      expect(observeInspection(intervening, 'a', policy, missing, 901_000).state).toBe('suspected_missing');
    }
  });
  it('does not promote unproved or ownership-related 404s', () => {
    expect(observeInspection(undefined, 'a', { ...policy, authoritativeAbsence: false }, missing, 0).state).toBe('unknown');
    expect(observeInspection(undefined, 'a', policy, { ...missing, artifacts: missing.artifacts.map(item => ({ ...item, authoritative: false })) }, 0).state).toBe('unknown');
  });
  it('models independent Wahoo Plan/Workout/association resources without Garmin assumptions', () => {
    const wahoo = { ...policy, required: ['plan', 'workout', 'association'] };
    const observation: InspectionObservation = { conflict: false, artifacts: wahoo.required.map(key => ({ key,
      state: key === 'association' ? 'absent' : 'present', authoritative: true })) };
    expect(observeInspection(undefined, 'a', wahoo, observation, 0).missingKeys).toEqual(['association']);
  });
  it('never infers Suunto Guide absence from partial, filtered, unstable or empty inventories', () => {
    const suunto = { ...policy, mode: 'inventory' as const, required: ['guide'] };
    for (const coverage of [undefined, { complete: false, stable: true, filtered: false, nextCursor: '50' },
      { complete: true, stable: false, filtered: false, nextCursor: null },
      { complete: true, stable: true, filtered: true, nextCursor: null }]) {
      expect(observeInspection(undefined, 'a', suunto, { conflict: false, artifacts: [
        { key: 'guide', state: 'absent', authoritative: true }], coverage }, 0).state).toBe('unknown');
    }
    expect(observeInspection(undefined, 'a', suunto, { conflict: false, artifacts: [] }, 0).state).toBe('unknown');
  });
  it('COROS unavailable is not a failure; duplicate identities cannot confirm absence', () => {
    expect(observeInspection(undefined, 'a', { ...policy, mode: 'unavailable' }, missing, 0).state).toBe('unsupported');
    expect(observeInspection(undefined, 'a', policy, { ...missing, artifacts: [...missing.artifacts, missing.artifacts[0]] }, 0).state).toBe('unknown');
  });
  it('retains manual priority through bounded inventory pages, then clears it on completion', () => {
    const suunto = { ...policy, mode: 'inventory' as const, required: ['guide'] };
    const previous = { ...observeInspection(undefined, 'a', suunto, { conflict: false, artifacts: [] }, 0), manualPending: true };
    const partial = observeInspection(previous, 'a', suunto, { conflict: false,
      artifacts: [{ key: 'guide', state: 'unknown', authoritative: false }],
      coverage: { complete: false, stable: true, filtered: false, nextCursor: '50' } }, 1);
    expect(partial).toMatchObject({ cursor: '50', manualPending: true, missing: false });
    expect(observeInspection(partial, 'a', suunto, { conflict: false,
      artifacts: [{ key: 'guide', state: 'present', authoritative: true }] }, 2)).toMatchObject({ state: 'present', cursor: null, manualPending: false });
  });
  it('treats malformed transport observations as unknown', () => {
    for (const value of [null, {}, { artifacts: [null], conflict: false },
      { ...missing, artifacts: [{ key: 'workout', state: 'invalid', authoritative: true }, missing.artifacts[1]] }]) {
      expect(observeInspection(undefined, 'a', policy, value as never, 0).state).toBe('unknown');
    }
  });
});
