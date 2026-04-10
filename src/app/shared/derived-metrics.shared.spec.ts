import { describe, expect, it } from 'vitest';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
  DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS,
  DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS,
  DEFAULT_DERIVED_METRIC_KINDS,
  buildDerivedFormDailyLoads,
  getDerivedMetricDocId,
  isDerivedMetricKind,
  normalizeDerivedFormDailyLoads,
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
    expect(getDerivedMetricDocId(DERIVED_METRIC_KINDS.Acwr)).toBe('acwr');
    expect(getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow)).toBe('recovery_now');
  });

  it('normalizes derived form daily loads for object and legacy tuple entries', () => {
    expect(normalizeDerivedFormDailyLoads([
      { dayMs: Date.UTC(2026, 0, 2), load: 5 },
      [Date.UTC(2026, 0, 1), 10],
      [Date.UTC(2026, 0, 2), 7],
      { dayMs: 'invalid', load: 1 },
      [Date.UTC(2026, 0, 3), -1],
    ])).toEqual([
      { dayMs: Date.UTC(2026, 0, 1), load: 10 },
      { dayMs: Date.UTC(2026, 0, 2), load: 12 },
    ]);
  });

  it('builds sorted Firestore-safe form daily loads from day maps', () => {
    expect(buildDerivedFormDailyLoads(new Map([
      [Date.UTC(2026, 0, 3), 4],
      [Date.UTC(2026, 0, 1), 9],
    ]))).toEqual([
      { dayMs: Date.UTC(2026, 0, 1), load: 9 },
      { dayMs: Date.UTC(2026, 0, 3), load: 4 },
    ]);
  });

  it('exposes recovery lookback constants for bounded derived recovery scans', () => {
    expect(DERIVED_METRIC_SCHEMA_VERSION).toBe(4);
    expect(DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS).toBe(14 * 24 * 60 * 60);
    expect(DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS).toBe(2 * 24 * 60 * 60);
    expect(DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS).toBe(
      DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS + DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS,
    );
  });
});
