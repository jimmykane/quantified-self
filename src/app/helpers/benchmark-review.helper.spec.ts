import { describe, expect, it } from 'vitest';
import type { BenchmarkResult } from '@shared/app-event.interface';
import { ElevationUnits } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import { buildBenchmarkReviewerSummary, resolveBenchmarkOverallGrade } from './benchmark-review.helper';

const result = (correlation: number | null): BenchmarkResult => ({
  referenceId: 'ref', testId: 'test', timestamp: new Date(0),
  metrics: {
    gnss: null,
    streamMetrics: { HeartRate: {
      sourceA_mean: 100, sourceB_mean: 101, pearsonCorrelation: correlation,
      meanAbsoluteError: 1, rootMeanSquareError: 1,
    } },
  },
});

describe('benchmark report availability', () => {
  it('converts altitude-error presentation without changing stored benchmark values or grades', () => {
    const report = result(0.99);
    report.metrics.streamMetrics.Altitude = { sourceA_mean: 100, sourceB_mean: 130.48,
      meanAbsoluteError: 3.048, rootMeanSquareError: 6.096, pearsonCorrelation: 0.98 };
    const original = JSON.stringify(report);
    const metres = buildBenchmarkReviewerSummary(report);
    const feet = buildBenchmarkReviewerSummary(report, [], { ...getDefaultUserUnitSettings(), elevationUnits: ElevationUnits.Feet });
    expect(metres.text).toContain('Alt: MD +30.5 m, MAE 3 m');
    expect(feet.text).toContain('Alt: MD +100 ft, MAE 10 ft');
    expect(feet.atAGlanceItems.find(item => item.key === 'altitude')?.detail).toContain('MAE 10 ft');
    expect(feet.atAGlanceItems.find(item => item.key === 'overall')).toEqual(metres.atAGlanceItems.find(item => item.key === 'overall'));
    expect(JSON.stringify(report)).toBe(original);
  });

  it.each([[0.99, 'excellent'], [0.96, 'good'], [0.91, 'fair'], [0.5, 'poor']] as const)(
    'grades heart-rate-only results from correlation %s without an invented GPS score', (correlation, grade) => {
      const report = result(correlation);
      expect(resolveBenchmarkOverallGrade(report)).toBe(grade);
      const summary = buildBenchmarkReviewerSummary(report);
      expect(summary.atAGlanceItems.find(item => item.key === 'gnss')?.value).toBe('No shared GPS data');
      expect(summary.text).toContain('GNSS: No shared GPS data');
      expect(summary.text).not.toContain('CEP50 0');
    },
  );

  it.each([null, NaN, Infinity])('keeps an unmeasurable correlation ungraded (%s)', correlation => {
    const report = result(correlation);
    expect(resolveBenchmarkOverallGrade(report)).toBe('unavailable');
    expect(buildBenchmarkReviewerSummary(report).text).toContain('Overall: No comparable grade');
  });

  it('retains legitimate zero GPS error in older reports', () => {
    const report = result(null);
    report.metrics.gnss = { cep50: 0, cep95: 0, rmse: 0, maxDeviation: 0, totalDistanceDifference: 0 };
    expect(resolveBenchmarkOverallGrade(report)).toBe('excellent');
  });

  it('marks copied summaries as historical after reparse', () => {
    const report = { ...result(1), requiresRegeneration: true };
    expect(resolveBenchmarkOverallGrade(report)).toBe('unavailable');
    expect(buildBenchmarkReviewerSummary(report).text).toContain('Overall: Regeneration required');
    expect(buildBenchmarkReviewerSummary(report).text).toContain('Previous report retained after reprocessing');
  });
});
