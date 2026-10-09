import { describe, expect, it } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildDashboardHealthExample } from './dashboard-health-preview.helper';
import { DASHBOARD_HEALTH_METRICS } from './dashboard-health-tile.helper';
import { resolveHealthWorkspaceWindow } from './health-workspace.helper';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';

describe('Health library examples', () => {
  const month = (metric: Parameters<typeof buildDashboardHealthExample>[0]['metric']) => {
    const settings = { metric, range: '30d' as const };
    return buildDashboardHealthExample(settings, resolveHealthWorkspaceWindow({ ...settings, endDate: '2026-08-31' }));
  };

  it('shows occasional weigh-ins and gradual fitness estimates instead of daily sawtooth patterns', () => {
    const weight = month('body_weight').selected!.model.series.points.map(point => Number(point.value));
    expect(weight.length).toBeGreaterThan(4);
    expect(weight.length).toBeLessThan(16);
    const changes = weight.slice(1).map((value, index) => value - weight[index]);
    expect(changes.some(change => change > 0)).toBe(true);
    expect(changes.some(change => change < 0)).toBe(true);
    expect(changes.every(change => Math.abs(change) <= 0.4)).toBe(true);
    const vo2 = month('vo2_max').selected!.model.series.points.map(point => Number(point.value));
    expect(vo2.length).toBeGreaterThan(2);
    expect(vo2.length).toBeLessThan(12);
    expect(vo2.slice(1).every((value, index) => Math.abs(value - vo2[index]) <= 0.3)).toBe(true);
    expect(vo2.some((value, index) => index > 0 && value < vo2[index - 1])).toBe(true);
    expect(vo2.some((value, index) => index > 0 && value > vo2[index - 1])).toBe(true);
  });

  it('varies nights and activity days without replaying the same two-week template', () => {
    const nights = month('sleep').sleep.points;
    expect(new Set(nights.map(night => night.deepSeconds)).size).toBeGreaterThan(6);
    expect(new Set(nights.map(night => night.remSeconds)).size).toBeGreaterThan(6);
    expect(new Set(nights.map(night => night.awakeSeconds)).size).toBeGreaterThan(6);
    expect(Math.max(...nights.map(night => night.totalSeconds)) - Math.min(...nights.map(night => night.totalSeconds))).toBeGreaterThan(3 * 3600);
    const steps = month('steps').selected!.model.series.points.map(point => Number(point.value));
    expect(Math.max(...steps) / Math.min(...steps)).toBeGreaterThan(4);
    for (const metric of ['steps', 'heart_rate_variability', 'resting_heart_rate'] as const) {
      const values = month(metric).selected!.model.series.points.map(point => point.value);
      expect(values.slice(0, 14)).not.toEqual(values.slice(14, 28));
    }
  });

  it('uses the same nightly HRV readings in the overview and Sleep history', () => {
    const hrv = month('heart_rate_variability').selected!.model.series.points;
    for (const night of month('sleep').sleep.points) {
      expect(night.averageHrvMs).toBe(hrv.find(point => point.calendarDate === night.sleepDate)?.value);
    }
  });

  it('keeps daily totals coherent and identifies actual observations rather than invented daily averages', () => {
    const values = (metric: Parameters<typeof month>[0]) => month(metric).selected!.model.series.points.map(point => Number(point.value));
    const activeEnergy = values('active_energy');
    const basalEnergy = values('basal_energy');
    expect(values('total_energy')).toEqual(activeEnergy.map((value, index) => value + basalEnergy[index]));
    expect(month('body_weight').selected!.model.series).toMatchObject({ aggregation: 'measurement', recordingMethod: 'manual' });
    expect(month('vo2_max').selected!.model.series.aggregation).toBe('latest');
    expect(month('altitude').selected!.model.series.aggregation).toBe('average');
    const settings = { metric: 'steps' as const, range: 'today' as const };
    const today = buildDashboardHealthExample(settings, resolveHealthWorkspaceWindow({ ...settings, endDate: '2026-08-31' }));
    expect(today.selected!.model.series.points).toHaveLength(1);
  });

  it('keeps fictional Sleep stages and elapsed night duration consistent', () => {
    const settings = { metric: 'sleep' as const, range: '30d' as const };
    const preview = buildDashboardHealthExample(settings, resolveHealthWorkspaceWindow({ ...settings, endDate: '2026-08-31' }));
    expect(preview.sleep.points).toHaveLength(30);
    for (const point of preview.sleep.points) {
      expect(point.deepSeconds + point.lightSeconds + point.remSeconds + point.unknownSeconds).toBe(point.totalSeconds);
      expect(point.endTimeMs - point.startTimeMs).toBeCloseTo((point.totalSeconds + point.awakeSeconds) * 1000, 3);
    }
  });
  it.each([...DASHBOARD_HEALTH_METRICS])('renders %s without qualifying it as account data or a selectable source', metric => {
    const settings = { metric, range: '30d' as const, sourceKey: 'missing-real-source' };
    const window = resolveHealthWorkspaceWindow({ ...settings, endDate: '2026-09-15' });
    const preview = buildDashboardHealthExample(settings, window);
    expect(preview.selected?.model.displayedPointCount || preview.sleep.points.length).toBeGreaterThan(1);
    if (preview.selected) expect(preview.selected.model.ariaLabel).toContain('Fictional readings');
    expect(preview.sources).toEqual([]); expect(preview.selectedKey).toBeNull();
    expect(preview.availability.hasData).toBe(false); expect(preview.availability.state).not.toBe('ready');
    expect(buildDashboardHealthExample(settings, window)).toEqual(preview);
    expect(settings.sourceKey).toBe('missing-real-source');
  });
  it.each(['today', '14d', '30d', '90d', '1y'] as const)('keeps example readings inside the %s preview period', range => {
    const settings = { metric: 'steps' as const, range };
    const window = resolveHealthWorkspaceWindow({ ...settings, endDate: '2026-09-15' });
    const preview = buildDashboardHealthExample(settings, window);
    expect(preview.selected!.model.displayedPoints.every(point => point.timestampMs >= window.startTimeMs && point.timestampMs <= window.endTimeMs)).toBe(true);
  });
  it('uses canonical values and user units in the same renderer as real readings', () => {
    for (const units of [normalizeUserUnitSettings(), normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })]) {
      const settings = { metric: 'wheelchair_push_distance' as const, range: '30d' as const };
      const window = resolveHealthWorkspaceWindow({ ...settings, endDate: '2026-09-15' });
      const preview = buildDashboardHealthExample(settings, window, units);
      const latest = preview.selected!.model.series.points.at(-1)!;
      const display = formatCanonicalHealthMetricSportsLibValue(settings.metric, Number(latest.value), units)!;
      expect(preview.selected!.latestValueText).toBe(`${display.value} ${display.unit}`);
    }
  });
});
