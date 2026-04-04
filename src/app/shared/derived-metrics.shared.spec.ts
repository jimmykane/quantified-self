import { describe, expect, it } from 'vitest';
import {
  DERIVED_METRIC_KINDS,
  DEFAULT_DERIVED_METRIC_KINDS,
  getDerivedMetricDocId,
  isDerivedMetricKind,
  normalizeDerivedMetricKinds,
  normalizeDerivedMetricKindsStrict,
} from '@shared/derived-metrics';

describe('derived-metrics shared helpers', () => {
  it('accepts every declared metric kind value', () => {
    const declaredKinds = Object.values(DERIVED_METRIC_KINDS);

    declaredKinds.forEach((metricKind) => {
      expect(isDerivedMetricKind(metricKind)).toBe(true);
    });
  });

  it('normalizes metric kinds with dedupe and preserves known values', () => {
    const normalized = normalizeDerivedMetricKinds([
      DERIVED_METRIC_KINDS.Form,
      'invalid',
      DERIVED_METRIC_KINDS.Form,
      DERIVED_METRIC_KINDS.RecoveryNow,
    ]);

    expect(normalized).toEqual([
      DERIVED_METRIC_KINDS.Form,
      DERIVED_METRIC_KINDS.RecoveryNow,
    ]);
  });

  it('falls back to default metric kinds when input is empty or invalid', () => {
    expect(normalizeDerivedMetricKinds([])).toEqual(DEFAULT_DERIVED_METRIC_KINDS);
    expect(normalizeDerivedMetricKinds(['unknown'])).toEqual(DEFAULT_DERIVED_METRIC_KINDS);
    expect(normalizeDerivedMetricKinds(null)).toEqual(DEFAULT_DERIVED_METRIC_KINDS);
  });

  it('keeps strict normalization empty for missing or invalid inputs', () => {
    expect(normalizeDerivedMetricKindsStrict([])).toEqual([]);
    expect(normalizeDerivedMetricKindsStrict(['unknown'])).toEqual([]);
    expect(normalizeDerivedMetricKindsStrict(null)).toEqual([]);
  });

  it('resolves metric kind guards and document ids', () => {
    expect(isDerivedMetricKind(DERIVED_METRIC_KINDS.Form)).toBe(true);
    expect(isDerivedMetricKind('random_metric')).toBe(false);
    expect(getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow)).toBe('derivedMetrics_recovery_now');
  });
});
