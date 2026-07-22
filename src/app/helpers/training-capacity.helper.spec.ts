import { describe, expect, it } from 'vitest';
import type { DashboardTrainingCapacityContext } from './dashboard-derived-metrics.helper';
import { buildTrainingCapacityViewModels } from './training-capacity.helper';

function buildContext(options: { ftp?: number; modeledPower?: number; vo2Max?: number } = {}): DashboardTrainingCapacityContext {
  const importedMetric = (
    kind: 'ftp-setting' | 'vo2-max',
    value: number,
  ) => ({
    kind,
    value,
    sourceKey: 'garmin-connect',
    provenance: 'imported-activity-stat' as const,
    firstSeenAtMs: Date.UTC(2026, 0, 1),
    lastSeenAtMs: Date.UTC(2026, 6, 12),
    observationCount: 12,
    previousValue: null,
    previousAtMs: null,
    previousSourceKey: null,
    changePct: null,
  });
  const modeledCriticalPower = options.modeledPower === undefined ? {
    status: 'insufficient-evidence' as const,
    valueWatts: null,
    valueWattsPerKg: null,
    wPrimeJoules: null,
    confidence: null,
    windowDays: 90 as const,
    sourceEventCount: 0,
    anchorPointCount: 0,
    minDurationSeconds: null,
    maxDurationSeconds: null,
    rSquared: null,
    normalizedRmse: null,
  } : {
    status: 'ready' as const,
    valueWatts: options.modeledPower,
    valueWattsPerKg: 2.48,
    wPrimeJoules: 18_000,
    confidence: 'high' as const,
    windowDays: 90 as const,
    sourceEventCount: 4,
    anchorPointCount: 5,
    minDurationSeconds: 180,
    maxDurationSeconds: 1_200,
    rSquared: 0.98,
    normalizedRmse: 0.03,
  };
  return {
    asOfDayMs: Date.UTC(2026, 6, 13),
    disciplines: [{
      discipline: 'running',
      ftpSetting: null,
      importedVo2Max: null,
      modeledCriticalPower: { ...modeledCriticalPower, status: 'insufficient-evidence', valueWatts: null, valueWattsPerKg: null, wPrimeJoules: null, confidence: null },
    }, {
      discipline: 'cycling',
      ftpSetting: options.ftp === undefined ? null : importedMetric('ftp-setting', options.ftp),
      importedVo2Max: options.vo2Max === undefined ? null : importedMetric('vo2-max', options.vo2Max),
      modeledCriticalPower,
    }],
  };
}

describe('training-capacity.helper', () => {
  it('labels imported settings and recent modeled performance with their evidence', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext({ ftp: 222, modeledPower: 226, vo2Max: 55.9 }))[1];

    expect(cycling.ftpSetting).toMatchObject({ label: 'FTP setting', valueText: '222 W' });
    expect(cycling.ftpSetting?.detailText).toContain('Imported from Garmin Connect');
    expect(cycling.modeledCriticalPower).toMatchObject({ label: 'Modeled critical power', valueText: '226 W · 2.48 W/kg' });
    expect(cycling.modeledCriticalPower.detailText).toContain('Best recorded 3–20 min efforts · last 90 days · Strong model fit');
    expect(cycling.modeledCriticalPower.detailText).toContain('4 power workouts in window');
    expect(cycling.modeledCriticalPower.detailText).not.toContain('confidence');
    expect(cycling.importedVo2Max).toMatchObject({ label: 'Imported VO₂ max', valueText: '55.9 ml/kg/min' });
    expect(cycling.interpretation.title).toBe('Recent power supports your FTP setting');
    expect(cycling.evidenceText).toContain('Evidence quality: strong');
  });

  it('does not describe a lower modeled CP as a decline', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext({ ftp: 222, modeledPower: 186 }))[1];

    expect(cycling.interpretation).toEqual({
      title: 'Recent efforts have not validated this FTP yet',
      description: 'The 90-day model sits below the imported setting, but this does not show that fitness declined. The curve may simply lack recent maximal efforts across the required durations.',
      tone: 'caution',
    });
  });

  it('keeps an imported FTP visible while saying that a model still needs evidence', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext({ ftp: 222 }))[1];

    expect(cycling.ftpSetting?.valueText).toBe('222 W');
    expect(cycling.modeledCriticalPower.valueText).toBe('Not enough evidence');
    expect(cycling.interpretation.title).toBe('FTP is an imported setting, not a new estimate');
  });

  it('does not compare an imported VO2 max with power thresholds', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext({ vo2Max: 55.9 }))[1];

    expect(cycling.interpretation.title).toBe('Only an imported aerobic marker is available');
    expect(cycling.interpretation.description).toContain('answer different questions');
  });

  it('uses neutral provenance copy when an activity has no source metadata', () => {
    const context = buildContext({ ftp: 222 });
    context.disciplines[1].ftpSetting = {
      ...context.disciplines[1].ftpSetting!,
      sourceKey: null,
    };

    const cycling = buildTrainingCapacityViewModels(context)[1];

    expect(cycling.ftpSetting?.detailText).toContain('Imported with workout data');
    expect(cycling.ftpSetting?.detailText).not.toContain('activity source');
  });
});
