import { describe, expect, it } from 'vitest';
import { ChartDataCategoryTypes } from '@sports-alliance/sports-lib';
import {
  isInverseMetric,
  resolveMetricSemantics,
  resolveMetricSummarySemantics,
} from '@shared/metric-semantics';

describe('metric-semantics', () => {
  it('treats pace-family metrics as inverse metrics', () => {
    expect(resolveMetricSemantics('Average Pace')).toEqual(expect.objectContaining({
      familyKey: 'pace',
      direction: 'inverse',
      highestValueLabel: 'slowest',
      lowestValueLabel: 'fastest',
    }));
    expect(resolveMetricSemantics('Average Grade Adjusted Pace')).toEqual(expect.objectContaining({
      familyKey: 'grade_adjusted_pace',
      direction: 'inverse',
    }));
    expect(resolveMetricSemantics('Average Effort Pace')).toEqual(expect.objectContaining({
      familyKey: 'effort_pace',
      direction: 'inverse',
    }));
    expect(resolveMetricSemantics('Average Swim Pace')).toEqual(expect.objectContaining({
      familyKey: 'swim_pace',
      direction: 'inverse',
    }));
    expect(isInverseMetric('Average Pace')).toBe(true);
  });

  it('treats direct metrics as highest and lowest semantics', () => {
    expect(resolveMetricSemantics('Average Speed')).toEqual(expect.objectContaining({
      familyKey: 'speed',
      direction: 'direct',
      highestValueLabel: 'highest',
      lowestValueLabel: 'lowest',
    }));
    expect(resolveMetricSemantics('Average Grade Adjusted Speed')).toEqual(expect.objectContaining({
      familyKey: 'grade_adjusted_speed',
      direction: 'direct',
    }));
    expect(resolveMetricSemantics('Average Power')).toEqual(expect.objectContaining({
      familyKey: 'power',
      direction: 'direct',
    }));
    expect(resolveMetricSemantics('Average Cadence')).toEqual(expect.objectContaining({
      familyKey: 'cadence',
      direction: 'direct',
    }));
    expect(resolveMetricSemantics('Average Heart Rate')).toEqual(expect.objectContaining({
      familyKey: 'heart_rate',
      direction: 'direct',
    }));
    expect(isInverseMetric('Average Heart Rate')).toBe(false);
  });

  it('builds date-based summary labels and help text from metric direction', () => {
    expect(resolveMetricSummarySemantics('Average Pace', ChartDataCategoryTypes.DateType)).toEqual(expect.objectContaining({
      highestLabel: 'Slowest period',
      lowestLabel: 'Fastest period',
      latestLabel: 'Latest period with data',
    }));
    expect(resolveMetricSummarySemantics('Average Heart Rate', ChartDataCategoryTypes.DateType)).toEqual(expect.objectContaining({
      highestLabel: 'Highest period',
      lowestLabel: 'Lowest period',
      latestLabel: 'Latest period with data',
    }));
  });

  it('builds group-based summary labels from metric direction', () => {
    expect(resolveMetricSummarySemantics('Average Pace', ChartDataCategoryTypes.ActivityType)).toEqual(expect.objectContaining({
      highestLabel: 'Slowest group',
      lowestLabel: 'Fastest group',
      latestLabel: 'Latest group',
    }));
    expect(resolveMetricSummarySemantics('Average Speed', ChartDataCategoryTypes.ActivityType)).toEqual(expect.objectContaining({
      highestLabel: 'Highest group',
      lowestLabel: 'Lowest group',
      latestLabel: 'Latest group',
    }));
  });
});
