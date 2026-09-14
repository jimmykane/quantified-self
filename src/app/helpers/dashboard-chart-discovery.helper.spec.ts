import { describe, expect, it } from 'vitest';
import { getDashboardChartCatalog } from './dashboard-chart-catalog.helper';
import { dashboardChartSuggestions, dismissAllDashboardChartSuggestions, isDashboardChartSuggestionDismissed, syncDashboardChartSuggestionStates, unseenDashboardCharts } from './dashboard-chart-discovery.helper';
import { DASHBOARD_CHART_LIBRARY_CURRENT_REVISION, newDashboardChartLibrarySeen } from './dashboard-chart-library-revision.helper';
import type { AppDashboardSettingsInterface } from '../models/app-user.interface';

const catalog = getDashboardChartCatalog();
const settings = () => ({ tiles: [] } as AppDashboardSettingsInterface);

describe('chart discovery', () => {
  it('suggests only eligible, missing charts, in product priority order with a limit of two', () => {
    const result = dashboardChartSuggestions(catalog, 'section:trainingState', settings(), entry => entry.definition.label !== 'Form (TSS)');
    expect(result.map(entry => entry.definition.label)).toEqual(['Sleep', 'HRV']);
    expect(dashboardChartSuggestions(catalog, 'section:trainingState', settings(), () => false)).toEqual([]);
    const saved = { tiles: result.map(entry => entry.tile) } as AppDashboardSettingsInterface;
    expect(dashboardChartSuggestions(catalog, 'section:trainingState', saved, () => true).map(entry => entry.definition.label)).toEqual(['Form (TSS)', 'Intensity Distribution']);
  });

  it('remembers removal for every preset, while explicit re-addition restores eligibility', () => {
    for (const entry of catalog) {
      const state = settings();
      syncDashboardChartSuggestionStates(state, [entry.tile], [], 1);
      expect(isDashboardChartSuggestionDismissed(entry, state)).toBe(true);
      syncDashboardChartSuggestionStates(state, [], [entry.tile], 2);
      expect(isDashboardChartSuggestionDismissed(entry, state)).toBe(false);
    }
  });

  it('honors legacy dismissal and suppresses every suggestion after Remove all', () => {
    const state = settings();
    state.autoTiles = { sleepTrend: { state: 'dismissed' } };
    expect(dashboardChartSuggestions(catalog, 'section:trainingState', state, () => true).map(entry => entry.definition.label)).toEqual(['Form (TSS)', 'HRV']);
    dismissAllDashboardChartSuggestions(state, 1);
    expect(catalog.every(entry => isDashboardChartSuggestionDismissed(entry, state))).toBe(true);
  });

  it('baselines the rollout and initializes newly created accounts at the current revision', () => {
    expect(unseenDashboardCharts(catalog, 'section:trainingState', undefined, [])).toEqual([]);
    expect(Object.values(newDashboardChartLibrarySeen()).every(value => value === DASHBOARD_CHART_LIBRARY_CURRENT_REVISION)).toBe(true);
    expect(catalog.every(entry => Number.isInteger(entry.definition.introducedIn) && entry.definition.introducedIn <= DASHBOARD_CHART_LIBRARY_CURRENT_REVISION)).toBe(true);
  });

  it('counts only new types in the section, excluding saved presets and acknowledged revisions', () => {
    const next = catalog.map((entry, index) => ({ ...entry, definition: { ...entry.definition, introducedIn: index % 2 ? 2 : 3 } }));
    const unseen = unseenDashboardCharts(next, 'section:trainingState', 2, []);
    expect(unseen.length).toBeGreaterThan(0);
    expect(unseen.every(entry => entry.lane === 'section:trainingState' && entry.definition.introducedIn === 3)).toBe(true);
    expect(unseenDashboardCharts(next, 'section:trainingState', 3, [])).toEqual([]);
    expect(unseenDashboardCharts(next, 'section:trainingState', 2, unseen.map(entry => entry.tile))).toEqual([]);
    expect(unseenDashboardCharts(catalog.map(entry => ({ ...entry, definition: { ...entry.definition, label: 'Renamed' } })), 'kpi', undefined, [])).toEqual([]);
  });
});
