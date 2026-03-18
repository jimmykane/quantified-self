import { describe, expect, it, vi } from 'vitest';
import { ChartDataValueTypes } from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import {
  findInsightMetricAliasMatch,
  getInsightMetricDefinition,
  isAggregationAllowedForMetric,
  resolveMetricVariantAlias,
  resolveInsightMetric,
} from './metric-catalog';

describe('metric-catalog', () => {
  it('resolves supported metrics from aliases', () => {
    expect(resolveInsightMetric('avg cadence')?.key).toBe('cadence');
    expect(resolveInsightMetric('mileage')?.key).toBe('distance');
    expect(resolveInsightMetric('gap')?.key).toBe('grade_adjusted_pace');
    expect(resolveInsightMetric('effort pace')?.key).toBe('effort_pace');
    expect(resolveInsightMetric('swim pace')?.key).toBe('swim_pace');
  });

  it('resolves family metrics to the correct concrete max data type', () => {
    expect(resolveInsightMetric('heart rate', ChartDataValueTypes.Maximum)?.dataType).toBe('Maximum Heart Rate');
    expect(resolveInsightMetric('max heart rate', ChartDataValueTypes.Average)?.dataType).toBe('Maximum Heart Rate');
    expect(resolveInsightMetric('gap', ChartDataValueTypes.Maximum)?.dataType).toBe('Maximum Grade Adjusted Pace');
    expect(resolveInsightMetric('effort pace', ChartDataValueTypes.Minimum)?.dataType).toBe('Minimum Effort Pace');
    expect(resolveInsightMetric('swim pace', ChartDataValueTypes.Maximum)?.dataType).toBe('Maximum Swim Pace');
  });

  it('prefers the explicit prompt alias that matches the requested family variant', () => {
    const heartRateMetric = resolveInsightMetric('heart rate');
    expect(heartRateMetric).toBeTruthy();
    if (!heartRateMetric) {
      return;
    }

    expect(resolveMetricVariantAlias(
      heartRateMetric,
      'What was my highest average heart rate last month',
    )).toBe('average heart rate');
    expect(resolveMetricVariantAlias(
      heartRateMetric,
      'What was my highest max heart rate last month',
    )).toBe('max heart rate');
  });

  it('returns null for unsupported metrics', () => {
    expect(resolveInsightMetric('ground contact time')).toBeNull();
  });

  it('finds the most specific alias inside the original prompt text', () => {
    expect(findInsightMetricAliasMatch('Show my average gap for trail running this month')).toEqual(
      expect.objectContaining({
        alias: 'average gap',
        metric: expect.objectContaining({ key: 'grade_adjusted_pace' }),
      }),
    );
    expect(findInsightMetricAliasMatch('Show my effort pace for running this month')).toEqual(
      expect.objectContaining({
        alias: 'effort pace',
        metric: expect.objectContaining({ key: 'effort_pace' }),
      }),
    );
    expect(findInsightMetricAliasMatch('Show my swim pace over time')).toEqual(
      expect.objectContaining({
        alias: 'swim pace',
        metric: expect.objectContaining({ key: 'swim_pace' }),
      }),
    );
  });

  it('exposes the supported aggregation set for each metric', () => {
    expect(isAggregationAllowedForMetric('distance', ChartDataValueTypes.Total)).toBe(true);
    expect(isAggregationAllowedForMetric('cadence', ChartDataValueTypes.Total)).toBe(false);
  });

  it('can retrieve canonical metric definitions by key', () => {
    expect(getInsightMetricDefinition('power')?.dataType).toBeTruthy();
  });
});
