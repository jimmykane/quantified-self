import { describe, expect, it, vi } from 'vitest';
import { ChartDataValueTypes } from '@sports-alliance/sports-lib';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import {
  getInsightMetricDefinition,
  isAggregationAllowedForMetric,
  resolveInsightMetric,
} from './metric-catalog';

describe('metric-catalog', () => {
  it('resolves supported metrics from aliases', () => {
    expect(resolveInsightMetric('avg cadence')?.key).toBe('cadence');
    expect(resolveInsightMetric('mileage')?.key).toBe('distance');
  });

  it('returns null for unsupported metrics', () => {
    expect(resolveInsightMetric('ground contact time')).toBeNull();
  });

  it('exposes the supported aggregation set for each metric', () => {
    expect(isAggregationAllowedForMetric('distance', ChartDataValueTypes.Total)).toBe(true);
    expect(isAggregationAllowedForMetric('cadence', ChartDataValueTypes.Total)).toBe(false);
  });

  it('can retrieve canonical metric definitions by key', () => {
    expect(getInsightMetricDefinition('power')?.dataType).toBeTruthy();
  });
});
