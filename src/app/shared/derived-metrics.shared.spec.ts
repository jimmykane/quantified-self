import { describe, expect, it } from 'vitest';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
  DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
  DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS,
  DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS,
  DERIVED_TRAINING_RECOVERY_MAX_BEDTIME_VARIATION_MINUTES,
  DERIVED_TRAINING_RECOVERY_MAX_VALID_SLEEP_SECONDS,
  DERIVED_TRAINING_RECOVERY_MIN_HRV_NIGHTS,
  DERIVED_TRAINING_RECOVERY_MIN_REGULARITY_NIGHTS,
  DERIVED_TRAINING_RECOVERY_MIN_SLEEP_NIGHTS,
  DERIVED_TRAINING_RECOVERY_MIN_VALID_SLEEP_SECONDS,
  DEFAULT_DERIVED_METRIC_KINDS,
  buildDerivedFormDailyLoads,
  getDerivedMetricDocId,
  getDerivedTrainingRecoveryMinimumComparableNights,
  getTrainingBuildBenchmarkSelectionKey,
  normalizeTrainingBuildEventId,
  normalizeTrainingBuildPeriodEndDayMs,
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

  it('shares Training recovery availability and comparison thresholds across builders and clients', () => {
    expect(DERIVED_TRAINING_RECOVERY_MIN_SLEEP_NIGHTS).toBe(3);
    expect(DERIVED_TRAINING_RECOVERY_MIN_REGULARITY_NIGHTS).toBe(5);
    expect(DERIVED_TRAINING_RECOVERY_MIN_HRV_NIGHTS).toBe(5);
    expect(DERIVED_TRAINING_RECOVERY_MIN_VALID_SLEEP_SECONDS).toBe(60 * 60);
    expect(DERIVED_TRAINING_RECOVERY_MAX_VALID_SLEEP_SECONDS).toBe(16 * 60 * 60);
    expect(DERIVED_TRAINING_RECOVERY_MAX_BEDTIME_VARIATION_MINUTES).toBe(12 * 60);
    expect(getDerivedTrainingRecoveryMinimumComparableNights(5)).toBe(7);
    expect(getDerivedTrainingRecoveryMinimumComparableNights(28)).toBe(14);
    expect(getDerivedTrainingRecoveryMinimumComparableNights(84)).toBe(42);
  });

  it('resolves metric kind guards and document ids', () => {
    expect(isDerivedMetricKind(DERIVED_METRIC_KINDS.Form)).toBe(true);
    expect(isDerivedMetricKind('random_metric')).toBe(false);
    expect(getDerivedMetricDocId(DERIVED_METRIC_KINDS.Acwr)).toBe('acwr');
    expect(getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow)).toBe('recovery_now');
  });

  it('normalizes only Firestore-safe event IDs for saved build references', () => {
    expect(normalizeTrainingBuildEventId(' event-1 ')).toBe('event-1');
    expect(normalizeTrainingBuildEventId('event/other')).toBeNull();
    expect(normalizeTrainingBuildEventId('.')).toBeNull();
    expect(normalizeTrainingBuildEventId('..')).toBeNull();
    expect(normalizeTrainingBuildEventId('__reserved__')).toBeNull();
    expect(normalizeTrainingBuildEventId('🏃'.repeat(400))).toBeNull();
    expect(getTrainingBuildBenchmarkSelectionKey({
      mode: 'event', durationWeeks: 10, eventId: 'event-1',
    })).toBe('event:10:event-1');
  });

  it('uses one UTC day and key for manual build benchmark dates', () => {
    const midday = Date.UTC(2026, 4, 10, 15, 30);
    const normalizedDay = Date.UTC(2026, 4, 10);

    expect(normalizeTrainingBuildPeriodEndDayMs(midday)).toBe(normalizedDay);
    expect(getTrainingBuildBenchmarkSelectionKey({
      mode: 'period', durationWeeks: 12, endDayMs: midday,
    })).toBe(`period:12:${normalizedDay}`);
    expect(normalizeTrainingBuildPeriodEndDayMs(1e100)).toBeNull();
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
    expect(DERIVED_METRIC_SCHEMA_VERSION).toBe(10);
    expect(DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS).toBe(14 * 24 * 60 * 60);
    expect(DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS).toBe(2 * 24 * 60 * 60);
    expect(DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS).toBe(
      DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS + DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS,
    );
  });
});
