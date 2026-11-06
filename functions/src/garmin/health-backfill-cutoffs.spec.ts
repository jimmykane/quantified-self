import { afterEach, describe, expect, it, vi } from 'vitest';
import { GARMIN_HEALTH_BACKFILL_CUTOFF_MAX_AGE_MS, garminHealthPermissionsRevision, knownUnavailableGarminHealthMinimum, rememberGarminHealthMinimum } from './health-backfill-cutoffs';

describe('Garmin Health run cutoff eligibility', () => {
  const now = Date.parse('2026-11-06T09:00:00Z');
  const minimum = now - 86_400_000;
  const valid = { minimumStartMs: minimum, observedAtMs: now, permissionsRevision: 'a'.repeat(64) };
  afterEach(() => vi.restoreAllMocks());
  it('skips only wholly unavailable ranges, preserving equality and overlapping windows', () => {
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', minimum - 1000, valid.permissionsRevision, now)).toBe(minimum);
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', minimum, valid.permissionsRevision, now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', minimum + 1000, valid.permissionsRevision, now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'stressDetails', minimum - 1000, valid.permissionsRevision, now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum(undefined, 'dailies', 0, valid.permissionsRevision, now)).toBeNull();
  });
  it.each([
    { minimumStartMs: -1 }, { minimumStartMs: Infinity }, { minimumStartMs: NaN },
    { minimumStartMs: now + 1 }, { minimumStartMs: '1' }, { minimumStartMs: minimum + 0.5 },
    { observedAtMs: -1 }, { observedAtMs: Infinity }, { observedAtMs: NaN },
    { observedAtMs: now + 1 }, { observedAtMs: '1' }, { observedAtMs: now - 0.5 },
    { observedAtMs: now - GARMIN_HEALTH_BACKFILL_CUTOFF_MAX_AGE_MS },
    { permissionsRevision: undefined }, { permissionsRevision: '' }, { permissionsRevision: 'invalid' },
  ])('ignores invalid or expired evidence: %j', invalid => {
    expect(knownUnavailableGarminHealthMinimum({ dailies: { ...valid, ...invalid } as never }, 'dailies', 0, valid.permissionsRevision, now)).toBeNull();
  });
  it('does not round a fractional cutoff down over an eligible whole second', () => {
    // Provider milliseconds may fall between whole-second query boundaries.
    expect(knownUnavailableGarminHealthMinimum({ dailies: { ...valid, minimumStartMs: minimum + 500 } }, 'dailies', minimum, valid.permissionsRevision, now)).toBe(minimum + 500);
  });
  it('rejects evidence from another permission state, including unknown current authority', () => {
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', 0, 'b'.repeat(64), now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', 0, null, now)).toBeNull();
    expect(knownUnavailableGarminHealthMinimum({ dailies: valid }, 'dailies', 0, valid.permissionsRevision, now)).toBe(minimum);
  });
  it('binds evidence to permission contents and provider change time without depending on list order', () => {
    const grants = { permissions: ['HEALTH_EXPORT', 'HISTORICAL_DATA_EXPORT'], permissionsLastChangedAt: 123 };
    const revision = garminHealthPermissionsRevision(grants);
    expect(revision).toMatch(/^[0-9a-f]{64}$/);
    expect(garminHealthPermissionsRevision({ ...grants, permissions: [...grants.permissions].reverse() })).toBe(revision);
    expect(garminHealthPermissionsRevision({ ...grants, permissions: ['HEALTH_EXPORT'] })).not.toBe(revision);
    expect(garminHealthPermissionsRevision({ ...grants, permissionsLastChangedAt: 124 })).not.toBe(revision);
    expect(garminHealthPermissionsRevision({ ...grants, permissions: ['HEALTH_EXPORT', {}] })).toBeNull();
    expect(garminHealthPermissionsRevision({ ...grants, permissionsLastChangedAt: NaN })).toBeNull();
  });
  it('retains response time across delayed writes and rejects an observation once its original hour expires', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const update = vi.fn();
    const transaction = { update } as unknown as Parameters<typeof rememberGarminHealthMinimum>[0];
    const run = { ref: {} } as Parameters<typeof rememberGarminHealthMinimum>[1];
    const observedAtMs = now - 1000;
    rememberGarminHealthMinimum(transaction, run, 'dailies', minimum, valid.permissionsRevision, valid.permissionsRevision, observedAtMs);
    expect(update).toHaveBeenCalledWith(run.ref, { 'garminHealthBackfillCutoffs.dailies': { ...valid, observedAtMs } });
    update.mockClear();
    clock.mockReturnValue(observedAtMs + GARMIN_HEALTH_BACKFILL_CUTOFF_MAX_AGE_MS);
    rememberGarminHealthMinimum(transaction, run, 'dailies', minimum, valid.permissionsRevision, valid.permissionsRevision, observedAtMs);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([
    { name: 'earlier boundary at the same time', offset: -1000, observedAtMs: now, writes: 1 },
    { name: 'later boundary at the same time', offset: 1000, observedAtMs: now, writes: 0 },
    { name: 'later boundary from a newer response', offset: 1000, observedAtMs: now + 1000, writes: 1 },
  ])('handles a $name according to observation order', ({ offset, observedAtMs, writes }) => {
    vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
    const update = vi.fn();
    const transaction = { update } as unknown as Parameters<typeof rememberGarminHealthMinimum>[0];
    const run = { ref: {}, cutoffs: { dailies: valid } } as Parameters<typeof rememberGarminHealthMinimum>[1];
    rememberGarminHealthMinimum(transaction, run, 'dailies', minimum + offset, valid.permissionsRevision, valid.permissionsRevision, observedAtMs);
    expect(update).toHaveBeenCalledTimes(writes);
  });
});
