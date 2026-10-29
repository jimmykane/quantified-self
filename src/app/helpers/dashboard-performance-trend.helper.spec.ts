import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataCriticalPower, DataPowerMax, DataPowerWork, DistanceUnits, WeightUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib/metrics';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { TRAINING_PREVIEW_DURABILITY, TRAINING_PREVIEW_POWER } from '../components/public-seo/training-explorer-preview.data';
import { buildDashboardPerformanceTrend } from './dashboard-performance-trend.helper';
import {
  normalizeDashboardPerformanceContext,
  normalizeDashboardChartTileDisplaySettingsForChartType,
} from './dashboard-chart-display-settings.helper';
import { formatTrainingPowerSystemsTrendValue, type TrainingPowerSystemsActivityTypeViewModel } from './training-power-systems.helper';
import type { TrainingDurabilityScopeViewModel } from './training-durability-view.helper';
import { buildDashboardManagerPresetTile } from './dashboard-manager-presets.helper';
import { dashboardPreviewMetricKinds, buildDashboardThumbnailPreview } from './dashboard-chart-preview.helper';
import * as powerModels from './training-power-systems.helper';
import * as durabilityModels from './training-durability-view.helper';


const power = (activityType: string): TrainingPowerSystemsActivityTypeViewModel => ({ activityType,
  trends: structuredClone(TRAINING_PREVIEW_POWER), cards: [], diagnostics: [], status: 'ready', statusText: 'Ready',
  reasonText: 'Recorded power evidence', evidenceText: 'Three usable workouts', interpretation: null,
});
const durability = (): TrainingDurabilityScopeViewModel => ({ scope: 'cycling', label: 'Cycling', conclusionText: '',
  evidenceQualityText: 'Limited evidence', nextStepText: null, evidenceText: '', coverageText: '', exclusionText: null,
  trendText: '', supportingEventsText: null, contexts: [{ contextKey: TRAINING_PREVIEW_DURABILITY.contextKey,
    label: 'Cycling · Power', metrics: [], sampleText: '', trajectory: structuredClone(TRAINING_PREVIEW_DURABILITY) }],
});

describe('dashboard performance integration', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['CriticalPowerHistory', 'WPrimeHistory', 'MaximumPowerHistory', 'DurabilityTrend'])(
    'keeps real context controls when a %s selection has no plottable evidence', type => {
      const entries = [power('Cycling'), power('Mountain Biking')];
      entries[1].trends.forEach(trend => trend.points.forEach(point => point.value = null));
      const scopes = [durability()];
      const empty = structuredClone(scopes[0].contexts[0]);
      empty.contextKey = 'swimming|speed|m/s|25|freestyle';
      empty.label = 'Pool swimming · 25 m · Freestyle';
      empty.trajectory.points.forEach(point => { point.value = null; point.candidateActivityCount = 0; });
      scopes[0].contexts.push(empty);
      vi.spyOn(powerModels, 'buildTrainingPowerSystemsActivityTypeViewModels').mockReturnValue(entries);
      vi.spyOn(durabilityModels, 'buildTrainingDurabilityScopeViewModels').mockReturnValue(scopes);
      const presetId = type === 'CriticalPowerHistory' ? 'curated-critical-power' : type === 'WPrimeHistory' ? 'curated-w-prime'
        : type === 'MaximumPowerHistory' ? 'curated-maximum-power' : 'curated-durability';
      const tile = buildDashboardManagerPresetTile({ presetId, order: 0, size: { columns: 1, rows: 1 } });
      const selectedKey = type === 'DurabilityTrend' ? empty.contextKey : 'Mountain Biking';
      tile['displaySettings'] = { performanceContext: selectedKey };
      const preview = buildDashboardThumbnailPreview(tile, { tiles: [] });
      expect(preview.source).toBe('user');
      expect(preview.availability).toMatchObject({ state: 'history', hasData: false });
      expect(preview.note).not.toContain('example');
      const context = preview.tile['performanceTrend'];
      expect(context.selectedKey).toBe(selectedKey);
      expect(context.options).toHaveLength(2);
      expect(context.options[0].value).not.toBe('example');
      // Returning to the context with usable evidence must still be possible.
      tile['displaySettings'] = { performanceContext: context.options[0].value };
      expect(buildDashboardThumbnailPreview(tile, { tiles: [] })).toMatchObject({ source: 'user', availability: { state: 'ready', hasData: true } });
    });

  it.each(['stale', 'missing', 'failed', 'ready'] as const)('retains a missing saved context while its metric is %s', status => {
    const tile = buildDashboardManagerPresetTile({ presetId: 'curated-critical-power', order: 0, size: { columns: 1, rows: 1 } });
    tile['displaySettings'] = { performanceContext: 'Mountain Biking' };
    const preview = buildDashboardThumbnailPreview(tile, { tiles: [], previewMetricStatuses: { training_power_systems: status } });
    expect(preview.source).toBe('user');
    expect(preview.availability?.hasData).toBe(false);
    expect(preview.tile['performanceTrend']).toMatchObject({ selectedKey: 'Mountain Biking', powerTrend: null,
      options: [{ value: 'Mountain Biking', label: 'Selected context unavailable' }] });
    expect(preview.note).not.toContain('example');
  });

  it.each([
    ['CriticalPowerHistory', 'criticalPowerWatts'], ['WPrimeHistory', 'wPrimeJoules'], ['MaximumPowerHistory', 'maximumPowerWatts'],
  ])('reuses the exact Training %s history without recomputing or combining sports', (type, key) => {
    const entries = [power('Cycling'), power('Mountain Biking')];
    const context = buildDashboardPerformanceTrend(type, entries, [], 'Mountain Biking');
    expect(context.selectedKey).toBe('Mountain Biking');
    expect(context.options.map(option => option.value)).toEqual(['Cycling', 'Mountain Biking']);
    expect(context.powerTrend).toBe(entries[1].trends.find(trend => trend.key === key));
    expect(context.powerTrend!.points.some(point => point.value === null)).toBe(true);
  });

  it('keeps the current value unavailable even when older fits are available', () => {
    const entry = power('Cycling');
    const current = entry.trends[0].points.find(point => point.isCurrent)!;
    current.value = null; current.statusText = 'Not enough evidence';
    const context = buildDashboardPerformanceTrend('CriticalPowerHistory', [entry], []);
    expect(context.valueText).toBe('Unavailable');
    expect(context.detailText).toBe('Not enough evidence');
    expect(context.powerTrend!.points.some(point => point.value !== null)).toBe(true);
  });

  it('prefers a context with evidence for the chosen metric, but never replaces a saved missing context', () => {
    const entries = [power('Cycling'), power('Running')];
    entries[0].trends[1].points.forEach(point => point.value = null);
    expect(buildDashboardPerformanceTrend('WPrimeHistory', entries, []).selectedKey).toBe('Running');
    const missing = buildDashboardPerformanceTrend('WPrimeHistory', entries, [], 'Mountain Biking');
    expect(missing.selectedKey).toBe('Mountain Biking');
    expect(missing.powerTrend).toBeNull();
    expect(missing.options.at(-1)).toEqual({ value: 'Mountain Biking', label: 'Selected context unavailable' });
  });

  it('reuses durability contexts, including gaps, without mixing output protocols', () => {
    const scope = durability();
    const context = buildDashboardPerformanceTrend('DurabilityTrend', [], [scope]);
    expect(context.trajectory).toBe(scope.contexts[0].trajectory);
    expect(context.selectedKey).toBe(scope.contexts[0].contextKey);
    expect(context.trajectory!.points.some(point => point.value === null)).toBe(true);
    expect(buildDashboardPerformanceTrend('DurabilityTrend', [], [scope], 'pool|25|freestyle').trajectory).toBeNull();
  });

  it.each([undefined, { distanceUnits: [DistanceUnits.Miles], weightUnits: [WeightUnits.Pounds] } as UserUnitSettingsInterface])(
    'formats capacity through canonical classes with unit settings %j', units => {
      for (const [index, stat] of [new DataCriticalPower(241), new DataPowerWork(16.4), new DataPowerMax(868)].entries()) {
        expect(formatTrainingPowerSystemsTrendValue(TRAINING_PREVIEW_POWER[index], [241, 16.4, 868][index], units))
          .toEqual(resolveUnitAwareDisplayStat(stat, units));
      }
    });

  it('normalizes bounded context settings only for their chart kinds', () => {
    expect(normalizeDashboardPerformanceContext(' Cycling ')).toBe('Cycling');
    for (const invalid of ['', '\nCycling', 'x'.repeat(513), null, 42]) expect(normalizeDashboardPerformanceContext(invalid)).toBeUndefined();
    expect(normalizeDashboardChartTileDisplaySettingsForChartType('DurabilityTrend', { performanceContext: 'pool|25|freestyle', derivedChartRange: 'all' }))
      .toEqual({ performanceContext: 'pool|25|freestyle' });
    expect(normalizeDashboardChartTileDisplaySettingsForChartType('RecoveryNowPie', { performanceContext: 'Cycling' })).toBeUndefined();
  });

  it('shares one existing power-system dependency and keeps examples explicitly separate from user data', () => {
    const ids = ['curated-critical-power', 'curated-w-prime', 'curated-maximum-power', 'curated-durability'];
    const tiles = ids.map(presetId => buildDashboardManagerPresetTile({ presetId: presetId as never, order: 0, size: { columns: 1, rows: 1 } }));
    expect(tiles.map(dashboardPreviewMetricKinds)).toEqual([['training_power_systems'], ['training_power_systems'], ['training_power_systems'], ['training_durability']]);
    for (const tile of tiles) {
      const preview = buildDashboardThumbnailPreview(tile, { tiles: [] });
      expect(preview.source).toBe('example');
      expect(preview.availability?.hasData).toBe(false);
      expect(preview.tile['performanceTrend']).toMatchObject({ valueText: 'Example data' });
    }
  });
});
