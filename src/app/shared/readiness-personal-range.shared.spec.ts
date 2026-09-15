import { describe, expect, it } from 'vitest';
import { buildReadinessSignals, buildReadinessHrvPersonalRange, readinessHrvObservations, resolveReadinessHrvScore,
  type ReadinessSleepEvidencePoint } from '@shared/readiness';
import { calculatePersonalMetricRange, HRV_PERSONAL_RANGE_OPTIONS } from '@shared/personal-metric-range';
import { normalizeDerivedTrainingReadinessMetricPayload } from '@shared/training-readiness-metric';
import { buildReadinessHrvDisplay } from '../helpers/readiness-hrv-display.helper';
import { normalizeReadinessHrvPersonalRange } from '@shared/readiness-hrv-validation';
import { buildHealthHrvPersonalRangeStatus, type HealthWorkspaceSeries } from '../helpers/health-workspace.helper';

const day = 86400000;
const now = Date.UTC(2026, 8, 13, 12);
function nights(values: number[]): ReadinessSleepEvidencePoint[] {
  return values.map((value, index) => {
    const endTimeMs = now - (values.length - index - 1) * day - 4 * 3600000;
    return { id: `${index}`, sourceKey: 'account-a', hrvSourceKey: 'sleep-average',
      provider: 'SuuntoApp', sleepDate: new Date(endTimeMs).toISOString().slice(0, 10),
      startTimeMs: endTimeMs - 8 * 3600000, endTimeMs, totalSeconds: 28800, score: 80,
      averageHrvMs: value, averageHeartRateBpm: 60, minimumHeartRateBpm: 50 };
  });
}
const history = () => nights([...Array(46).fill(45), ...Array(13).fill(31), 32]);

describe('readiness shared HRV personal range', () => {
  it('round-trips floating-point ranges without rejecting valid history at a classification boundary', () => {
    for (const value of [0.1, 1.1, 31.3, 42.7, 127.19]) {
      for (const values of [Array(60).fill(value), [...Array(7).fill(value), ...Array(7).fill(value * 2)]]) {
        const range = buildReadinessHrvPersonalRange(nights(values), now)!;
        expect(normalizeReadinessHrvPersonalRange(range)).toEqual(range);
      }
    }
  });

  it('uses the current instant for a chart ending tonight, matching Readiness at rolling-window boundaries', () => {
    const points = history();
    // This reading is still in the current week now, but will expire before midnight.
    points[53].endTimeMs = now - 7 * day + 3600000;
    const series = { semanticVariant: 'sleep_session_average_hrv', points: points.map(point => ({
      timestampMs: point.endTimeMs, calendarDate: point.sleepDate, value: point.averageHrvMs,
    })) } as HealthWorkspaceSeries;
    const chart = buildHealthHrvPersonalRangeStatus(series, Math.floor(now / day) * day + day - 1,
      null, undefined, undefined, now)!;
    const readiness = buildReadinessHrvPersonalRange(points, now)!;
    expect(chart.currentAverage).toBe(readiness.currentAverage);
    expect(chart.normalRange).toEqual(readiness.normalRange);
  });

  it('uses exactly the chart range when the latest night exceeds a short baseline but the week is below its usual range', () => {
    const points = history();
    const range = buildReadinessHrvPersonalRange(points, now)!;
    const chart = calculatePersonalMetricRange(points.map(point => ({ timestampMs: point.endTimeMs!,
      calendarDate: point.sleepDate, value: point.averageHrvMs! })), now, HRV_PERSONAL_RANGE_OPTIONS);
    expect(range).toEqual({ ...chart, latestMs: 32, latestAtMs: points.at(-1)!.endTimeMs });
    expect(range.currentAverage).toBeCloseTo(31 + 1 / 7);
    expect(range.currentAverage).toBeLessThan(range.normalRange!.min);
    expect(range.reason).toBe('outside_range');
    expect(buildReadinessSignals({ form: -19.6, rampRate: 3.9, sleepPoints: points, nowMs: now })?.hrvRatio).toBeLessThan(1);
  });

  it('needs 14 distinct baseline days and 3 days in the current week', () => {
    expect(buildReadinessHrvPersonalRange(nights(Array(13).fill(40)), now)?.reason).toBe('building_baseline');
    expect(buildReadinessHrvPersonalRange(nights(Array(14).fill(40)), now)?.reason).toBe('within_range');
    expect(buildReadinessHrvPersonalRange(history().filter((_, i) => i < 53 || i > 57), now)?.reason)
      .toBe('insufficient_current');
  });

  it('excludes future and older evidence at each historical cutoff, regardless of visible history', () => {
    const points = nights(Array.from({ length: 365 }, (_, i) => 30 + i % 17));
    const cutoff = now - 20 * day;
    const expected = points.filter(point => point.endTimeMs! <= cutoff && point.endTimeMs! > cutoff - 60 * day);
    expect(buildReadinessHrvPersonalRange(points, cutoff)).toEqual(buildReadinessHrvPersonalRange(expected, cutoff));
  });

  it('never mixes provider accounts or overnight measurement types', () => {
    const points = history();
    for (const change of [{ sourceKey: 'account-b' }, { hrvSourceKey: 'overnight-rmssd' }, { provider: 'GarminAPI' as const }]) {
      expect(buildReadinessHrvPersonalRange([...points.slice(0, -1), { ...points.at(-1)!, ...change }], now)?.reason)
        .toBe('building_baseline');
    }
  });

  it('preserves the chart daily median when a night contains several sleep fragments', () => {
    const points = history();
    const last = points.at(-1)!;
    const fragments = [20, 30, 100].map((value, index) => ({ ...last, averageHrvMs: value,
      endTimeMs: last.endTimeMs! - (2 - index) * 3600000 }));
    const grouped = { ...last, averageHrvMs: 50, hrvObservations: fragments.flatMap(readinessHrvObservations) };
    const result = buildReadinessHrvPersonalRange([...points.slice(0, -1), grouped], now)!;
    const chart = calculatePersonalMetricRange([...points.slice(0, -1), ...fragments].flatMap(readinessHrvObservations),
      now, HRV_PERSONAL_RANGE_OPTIONS);
    expect(result).toEqual({ ...chart, latestMs: 100, latestAtMs: last.endTimeMs });
    expect(result.currentAverage).toBeCloseTo((31 * 6 + 30) / 7);
  });

  it('keeps completed HRV fragments when another fragment of the same night ends after the cutoff', () => {
    const points = history();
    const last = points.at(-1)!;
    const future = { ...last, endTimeMs: now + 3600000, averageHrvMs: 100 };
    const grouped = { ...last, endTimeMs: future.endTimeMs,
      hrvObservations: [last, future].flatMap(readinessHrvObservations) };
    expect(buildReadinessHrvPersonalRange([...points.slice(0, -1), grouped], now))
      .toEqual(buildReadinessHrvPersonalRange(points, now));
  });

  it('keeps the weekly HRV signal when the latest sleep has no HRV, and leaves other drivers unchanged', () => {
    const points = history();
    points.at(-1)!.averageHrvMs = null;
    const result = buildReadinessSignals({ sleepPoints: points, nowMs: now });
    expect(result?.availableSignalCount).toBe(3);
    expect(result?.hrvPersonalRange?.currentObservationDayCount).toBe(6);
    expect(result?.averageHeartRateRatio).toBe(1);
    expect(result?.minimumHeartRateRatio).toBe(1);
  });

  it('does not reward unusually high HRV or turn absent evidence into a zero score', () => {
    const low = buildReadinessHrvPersonalRange(history(), now)!;
    const high = buildReadinessHrvPersonalRange(nights([...Array(53).fill(30), ...Array(7).fill(70)]), now)!;
    const usual = buildReadinessHrvPersonalRange(nights(Array(60).fill(40)), now)!;
    expect(resolveReadinessHrvScore(low)).toBeLessThan(50);
    expect(resolveReadinessHrvScore(high)).toBeLessThan(50);
    expect(resolveReadinessHrvScore(usual)).toBe(50);
    expect(resolveReadinessHrvScore(null)).toBeNull();
  });

  it('shows the weekly value, actual range and latest night without a misleading percent comparison', () => {
    const view = buildReadinessHrvDisplay(buildReadinessHrvPersonalRange(history(), now));
    expect(view.valueText).toBe('31.1 ms');
    expect(view.statusText).toBe('Below personal range');
    expect(view.rangeText).toMatch(/^60-day range [\d.]+–[\d.]+ ms$/);
    expect(view.latestText).toBe('Latest night 32 ms');
    expect(JSON.stringify(view)).not.toContain('%');
    expect(buildReadinessHrvDisplay(null)).toMatchObject({ valueText: '—', statusText: 'No recent HRV', latestText: '' });
    expect(buildReadinessHrvDisplay(buildReadinessHrvPersonalRange(nights(Array(5).fill(40)), now)))
      .toMatchObject({ valueText: '—', statusText: 'Building range · 5/14 nights' });
  });

  it('validates current history and rejects stale formulas, inconsistent scores, missing ranges and future evidence', () => {
    const asOfDayMs = Math.floor(now / day) * day;
    const points = Array.from({ length: 14 }, (_, index) => {
      const dayMs = asOfDayMs - (13 - index) * day;
      const cutoff = index === 13 ? now : dayMs + day - 1;
      return { dayMs, ...buildReadinessSignals({ form: 10, sleepPoints: history(), nowMs: cutoff })! };
    });
    const payload = { formulaVersion: 4, evidenceVersion: 1, dayBoundary: 'UTC', asOfDayMs,
      generatedAtMs: now, historyDays: 14, points };
    expect(normalizeDerivedTrainingReadinessMetricPayload(payload)).toEqual(payload);
    expect(normalizeDerivedTrainingReadinessMetricPayload({ ...payload, formulaVersion: 3 })).toBeNull();
    for (const change of [{ score: 99 }, { hrvPersonalRange: undefined }, { hrvRatio: 1.5 },
      { hrvPersonalRange: { ...points.at(-1)!.hrvPersonalRange, latestAtMs: now + 1 } },
      { hrvPersonalRange: { ...points.at(-1)!.hrvPersonalRange, latestAtMs: now - 8 * day } }]) {
      expect(normalizeDerivedTrainingReadinessMetricPayload({ ...payload,
        points: [...points.slice(0, -1), { ...points.at(-1), ...change }] })).toBeNull();
    }
    const insufficient = buildReadinessHrvPersonalRange(history().filter((_, i) => i < 53 || i > 57), now)!;
    expect(normalizeReadinessHrvPersonalRange({ ...insufficient, observationDayCount: 1, currentObservationDayCount: 2,
      reason: 'building_baseline' })).toBeNull();
  });
});
