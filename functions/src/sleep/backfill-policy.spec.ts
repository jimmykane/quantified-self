import { describe, expect, it } from 'vitest';
import { SLEEP_PROVIDERS, type SleepProvider } from '../../../shared/sleep';
import { getHealthBackfillStartMs, getSleepBackfillWindowDays, getSleepBackfillCooldownDays } from '../../../shared/sleep-backfill';

describe('provider Health and Sleep history policies', () => {
  const now = Date.parse('2026-09-09T12:34:56.789Z');

  it.each([
    [SLEEP_PROVIDERS.GarminAPI, '2021-09-09T12:34:56.789Z'],
    [SLEEP_PROVIDERS.SuuntoApp, '2000-01-01T00:00:00.000Z'],
    [SLEEP_PROVIDERS.COROSAPI, '2026-06-09T12:34:56.789Z'],
  ])('uses an explicit policy for %s', (provider, expected) => {
    expect(getHealthBackfillStartMs(provider as SleepProvider, now)).toBe(Date.parse(expected));
  });

  it.each([
    [SLEEP_PROVIDERS.GarminAPI, '2024-02-29T23:45:12.123Z', '2019-02-28T23:45:12.123Z'],
    [SLEEP_PROVIDERS.GarminAPI, '2026-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z'],
    [SLEEP_PROVIDERS.COROSAPI, '2026-05-31T12:00:00.000Z', '2026-02-28T12:00:00.000Z'],
    [SLEEP_PROVIDERS.COROSAPI, '2024-05-31T12:00:00.000Z', '2024-02-29T12:00:00.000Z'],
    [SLEEP_PROVIDERS.COROSAPI, '2026-01-31T12:00:00.000Z', '2025-10-31T12:00:00.000Z'],
  ])('handles calendar boundaries for %s at %s', (provider, requestTime, expected) => {
    expect(getHealthBackfillStartMs(provider as SleepProvider, Date.parse(requestTime))).toBe(Date.parse(expected));
  });

  it.each([NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER])('rejects an invalid request time %s', nowMs => {
    for (const provider of [SLEEP_PROVIDERS.GarminAPI, SLEEP_PROVIDERS.SuuntoApp, SLEEP_PROVIDERS.COROSAPI]) {
      expect(() => getHealthBackfillStartMs(provider, nowMs)).toThrow();
    }
  });

  it('rejects unsupported providers and preserves request windows and cooldowns', () => {
    expect(() => getHealthBackfillStartMs('unsupported' as SleepProvider, now)).toThrow();
    expect([SLEEP_PROVIDERS.GarminAPI, SLEEP_PROVIDERS.SuuntoApp, SLEEP_PROVIDERS.COROSAPI]
      .map(provider => [getSleepBackfillWindowDays(provider), getSleepBackfillCooldownDays(provider)]))
      .toEqual([[89, 30], [28, 7], [30, 7]]);
  });
});
