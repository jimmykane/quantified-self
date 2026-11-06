import { describe, expect, it } from 'vitest';
import { GARMIN_HEALTH_BACKFILL_CUTOFF_MAX_AGE_MS, knownUnavailableGarminHealthMinimum } from './health-backfill-cutoffs';

describe('Garmin Health run cutoff eligibility', () => {
  const now = Date.parse('2026-11-06T09:00:00Z');
  const minimum = now - 86_400_000;
  const valid = { minimumStartMs: minimum, observedAtMs: now };
  it('skips only wholly unavailable ranges, preserving equality and overlapping windows', () => {
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', minimum - 1000, now)).toBe(minimum);
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', minimum, now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', minimum + 1000, now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'stressDetails', minimum - 1000, now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum(undefined, 'dailies', 0, now)).toBeNull();
  });
  it.each([
    { minimumStartMs: -1 }, { minimumStartMs: Infinity }, { minimumStartMs: NaN },
    { minimumStartMs: now + 1 }, { minimumStartMs: '1' }, { minimumStartMs: minimum + 0.5 },
    { observedAtMs: -1 }, { observedAtMs: Infinity }, { observedAtMs: NaN },
    { observedAtMs: now + 1 }, { observedAtMs: '1' }, { observedAtMs: now - 0.5 },
    { observedAtMs: now - GARMIN_HEALTH_BACKFILL_CUTOFF_MAX_AGE_MS },
  ])('ignores invalid or expired evidence: %j', invalid => {
    expect(knownUnavailableGarminHealthMinimum({ dailies: { ...valid, ...invalid } as never }, 'dailies', 0, now)).toBeNull();
  });
  it('does not round a fractional cutoff down over an eligible whole second', () => {
    // Provider milliseconds may fall between whole-second query boundaries.
    expect(knownUnavailableGarminHealthMinimum({ dailies: { ...valid, minimumStartMs: minimum + 500 } }, 'dailies', minimum, now)).toBe(minimum + 500);
  });
});
