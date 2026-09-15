import { describe, expect, it } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildDashboardHealthExample } from './dashboard-health-preview.helper';
import { DASHBOARD_HEALTH_METRICS } from './dashboard-health-tile.helper';
import { resolveHealthWorkspaceWindow } from './health-workspace.helper';
import { formatCanonicalHealthMetricSportsLibValue } from '@shared/sports-lib-health-data';

describe('Health library examples', () => {
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
