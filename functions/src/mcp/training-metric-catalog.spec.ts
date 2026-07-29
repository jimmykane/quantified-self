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
