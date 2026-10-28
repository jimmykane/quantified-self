import { describe, expect, it } from 'vitest';
import {
  DERIVED_METRIC_KINDS,
} from '../../../shared/derived-metrics';
import {
  getMcpTrainingMetricDescriptors,
} from './training-metric-catalog';

describe('MCP Training metric catalog', () => {
  it('describes every authoritative derived metric kind exactly once', () => {
    const descriptors = getMcpTrainingMetricDescriptors();

    expect(descriptors.map(descriptor => descriptor.metricKind).sort()).toEqual(
      Object.values(DERIVED_METRIC_KINDS).sort(),
    );
    expect(new Set(descriptors.map(descriptor => descriptor.metricKind)).size)
      .toBe(descriptors.length);
    expect(descriptors.every(descriptor => (
      descriptor.title.length > 0
      && descriptor.description.length > 0
      && descriptor.periodLabel.length > 0
    ))).toBe(true);
  });

  it('explains source-specific intensity while retaining the existing catalog kinds', () => {
    const descriptors = getMcpTrainingMetricDescriptors();
    for (const kind of [DERIVED_METRIC_KINDS.IntensityDistribution, DERIVED_METRIC_KINDS.TrainingSummary,
      DERIVED_METRIC_KINDS.TrainingBuildComparison]) {
      const description = descriptors.find(entry => entry.metricKind === kind)?.description;
      expect(description).toContain('HR');
      expect(description).toContain('Z4–Z5');
      expect(description).toContain('Z5–Z7');
      expect(description).toContain('per activity');
    }
  });

  it('searches presentation text without creating another validity registry', () => {
    expect(getMcpTrainingMetricDescriptors('readiness').map(
      descriptor => descriptor.metricKind,
    )).toContain(DERIVED_METRIC_KINDS.TrainingReadiness);
    expect(getMcpTrainingMetricDescriptors('swolf').map(
      descriptor => descriptor.metricKind,
    )).toEqual([DERIVED_METRIC_KINDS.TrainingSwimPerformance]);
    expect(getMcpTrainingMetricDescriptors('no such metric')).toEqual([]);
  });
});
