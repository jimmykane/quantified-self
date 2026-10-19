import { describe, expect, it } from 'vitest';
import { HEALTH_METRIC_CATALOG, type HealthMetricId } from '@shared/health';
import { selectDefaultHealthSourceKey, type HealthSourceSelectionCandidate } from './health-source-selection.helper';

function candidate(key: string, metricId: HealthMetricId, value: number | string | boolean, date = '2026-09-14'): HealthSourceSelectionCandidate {
  return { key, metricId, points: [{ value, calendarDate: date, timestampMs: Date.parse(`${date}T12:00:00Z`) }] };
}

describe('automatic Health source selection', () => {
  it('starts Heart rate with daytime readings ahead of a same-day rolling summary, without preferring stale data', () => {
    const rolling = { ...candidate('rolling', 'heart_rate', 90), semanticVariant: 'rolling_7_day_average' };
    const daytime = { ...candidate('daytime', 'heart_rate', 60), semanticVariant: 'activity_interval_average' };
    expect(selectDefaultHealthSourceKey([rolling, daytime])).toBe('daytime');
    expect(selectDefaultHealthSourceKey([rolling, { ...daytime, points: candidate('older', 'heart_rate', 60, '2026-09-13').points }])).toBe('rolling');
  });
  it.each(Object.values(HEALTH_METRIC_CATALOG))('uses recorded freshness for $id instead of provider order', metric => {
    const value = metric.valueType === 'category' ? 'rest' : 54;
    expect(selectDefaultHealthSourceKey([
      candidate('Garmin', metric.id, value), candidate('Suunto', metric.id, value, '2026-09-15'),
    ])).toBe('Suunto');
  });
  it.each(['steps', 'resting_heart_rate', 'heart_rate_variability', 'body_weight', 'vo2_max', 'active_energy'] as const)(
    'prefers useful %s readings over a more recent all-zero source without discarding zeros', metric => {
      const zero = candidate('Garmin', metric, 0, '2026-09-15');
      expect(selectDefaultHealthSourceKey([zero, candidate('Suunto', metric, 54)])).toBe('Suunto');
      expect(selectDefaultHealthSourceKey([zero])).toBe('Garmin');
      expect(zero.points[0].value).toBe(0);
    });
  it.each(['skin_temperature_deviation', 'stress_level', 'body_energy_change', 'body_energy', 'recovery_score', 'sleep_score', 'altitude'] as const)(
    'does not penalize meaningful zero %s readings', metric => {
      expect(selectDefaultHealthSourceKey([
        candidate('Suunto', metric, 2), candidate('Garmin', metric, 0, '2026-09-15'),
      ])).toBe('Garmin');
    });
  it('keeps categorical states and boolean false eligible', () => {
    expect(selectDefaultHealthSourceKey([
      candidate('first', 'stress_state', 'stress'), candidate('second', 'stress_state', false, '2026-09-15'),
    ])).toBe('second');
  });
  it('uses distinct days of coverage independently of sample frequency', () => {
    const sparse = candidate('sparse', 'steps', 100, '2026-09-15');
    sparse.points = Array.from({ length: 100 }, () => sparse.points[0]);
    const covered = candidate('covered', 'steps', 200, '2026-09-15');
    covered.points = [candidate('earlier', 'steps', 200).points[0], ...covered.points];
    expect(selectDefaultHealthSourceKey([sparse, covered])).toBe('covered');
  });
  it('does not let recent zeros conceal the age of useful readings', () => {
    const older = candidate('older', 'steps', 100, '2026-09-13');
    older.points = [...older.points, candidate('zero', 'steps', 0, '2026-09-15').points[0]];
    expect(selectDefaultHealthSourceKey([older, candidate('current', 'steps', 200)])).toBe('current');
  });
  it('preserves main Sleep and canonical readings ahead of alternate semantics or native scales', () => {
    const main = candidate('main', 'sleep_duration', 27000);
    const nap = { ...candidate('nap', 'sleep_duration', 1800, '2026-09-15'), semanticVariant: 'nap_duration' };
    expect(selectDefaultHealthSourceKey([nap, main])).toBe('main');
    const canonical = candidate('canonical', 'body_energy', 50);
    const native = { ...candidate('native', 'body_energy', 60, '2026-09-15'), nativeOnly: true };
    expect(selectDefaultHealthSourceKey([native, canonical])).toBe('canonical');
  });
  it('ignores invalid or empty points and retains deterministic ties without mutating evidence', () => {
    const first = candidate('first', 'steps', 100), second = candidate('second', 'steps', 100);
    const candidates = [first, second];
    expect(selectDefaultHealthSourceKey(candidates)).toBe('first');
    expect(candidates).toEqual([first, second]);
    expect(selectDefaultHealthSourceKey([{ ...first, points: [] }, candidate('nan', 'steps', Number.NaN),
      { ...second, points: [{ ...second.points[0], timestampMs: Number.NaN }] }])).toBeNull();
  });
});
