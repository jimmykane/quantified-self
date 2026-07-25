import { describe, expect, it } from 'vitest';
import type { DashboardTrainingCapacityContext } from './dashboard-derived-metrics.helper';
import { buildTrainingCapacityViewModels } from './training-capacity.helper';

function buildContext(options: { ftp?: number; vo2Max?: number } = {}): DashboardTrainingCapacityContext {
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
  return {
    asOfDayMs: Date.UTC(2026, 6, 13),
    disciplines: [{
      discipline: 'running',
      ftpSetting: null,
      importedVo2Max: null,
    }, {
      discipline: 'cycling',
      ftpSetting: options.ftp === undefined ? null : importedMetric('ftp-setting', options.ftp),
      importedVo2Max: options.vo2Max === undefined ? null : importedMetric('vo2-max', options.vo2Max),
    }],
  };
}

describe('training-capacity.helper', () => {
  it('labels imported FTP and VO2 max with their source provenance', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext({ ftp: 222, vo2Max: 55.9 }))[1];

    expect(cycling.ftpSetting).toMatchObject({ label: 'FTP setting', valueText: '222 W' });
    expect(cycling.ftpSetting?.detailText).toContain('Imported from Garmin Connect');
    expect(cycling.importedVo2Max).toMatchObject({
      label: 'Imported VO₂ max',
      valueText: '55.9 ml/kg/min',
    });
    expect(cycling.evidenceText).toContain('not fitted or compared');
    expect(cycling).not.toHaveProperty('modeledCriticalPower');
  });

  it('keeps an imported FTP visible without presenting it as a QS estimate', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext({ ftp: 222 }))[1];

    expect(cycling.ftpSetting?.valueText).toBe('222 W');
    expect(cycling.evidenceText).toContain('not a new Quantified Self estimate');
  });

  it('does not compare an imported VO2 max with a power threshold', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext({ vo2Max: 55.9 }))[1];

    expect(cycling.evidenceText).toContain('not interchangeable with a power threshold');
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

  it('keeps both imported markers unavailable instead of manufacturing zero values', () => {
    const cycling = buildTrainingCapacityViewModels(buildContext())[1];

    expect(cycling.ftpSetting).toBeNull();
    expect(cycling.importedVo2Max).toBeNull();
    expect(cycling.evidenceText).toContain('No imported FTP or VO₂ max');
  });
});
