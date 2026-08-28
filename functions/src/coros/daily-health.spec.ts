import { describe, expect, it } from 'vitest';
import {
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_SLEEP_REFERENCE_FIELDS,
} from '../../../shared/health';
import { validateHealthSourceRecordInput } from '../health/validation';
import { mapCOROSDailyHealth } from './daily-health';
import { parseCOROSDailyRecord } from './daily';

const RECEIVED_AT_MS = Date.parse('2026-05-18T12:00:00.000Z');
const SLEEP_DOCUMENT_ID = 'a'.repeat(64);

describe('COROS daily health mapping', () => {
  it('maps daily aggregates, sleep references, and bounded overnight sample series', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: '2026-05-16 23:00:00',
      sleepEndTime: '2026-05-17 07:00:00',
      startTimezone: 12,
      endTimezone: 12,
      step: 12_345,
      calorie: 2_478.5,
      rhr: 47,
      ppgHrv: 62,
      sleepAvgHr: 51,
      hrvList: [
        { timestamp: Date.parse('2026-05-15T20:59:59.000Z') / 1000, hrv: 20 },
        { timestamp: Date.parse('2026-05-16T19:00:00.000Z') / 1000, hrv: 58 },
        { timestamp: Date.parse('2026-05-17T01:00:00.000Z') / 1000, hrv: 60, hr: 50 },
        { timestamp: Date.parse('2026-05-17T20:59:59.000Z') / 1000, hr: 55 },
        { timestamp: Date.parse('2026-05-17T21:00:00.000Z') / 1000, hrv: 99 },
      ],
    });

    const mapped = mapCOROSDailyHealth(
      parsed,
      'private-coros-account',
      RECEIVED_AT_MS,
      SLEEP_DOCUMENT_ID,
    );

    expect(mapped).not.toBeNull();
    const input = validateHealthSourceRecordInput(mapped?.input);
    expect(input).toMatchObject({
      providerAccountId: 'private-coros-account',
      sourceRecordType: 'coros_daily',
      sourceRecordKey: '20260517',
      calendarDate: '2026-05-17',
      startTimeMs: Date.parse('2026-05-16T19:00:00.000Z'),
      endTimeMs: Date.parse('2026-05-17T21:00:00.000Z'),
      timezoneOffsetSeconds: 3 * 60 * 60,
    });
    expect(mapped?.observedAtMs).toBe(Date.parse('2026-05-17T21:00:00.000Z') - 1);

    expect(input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'value',
        metricId: HEALTH_METRIC_IDS.Steps,
        canonical: { value: 12_345, unit: 'count' },
      }),
      expect.objectContaining({
        kind: 'value',
        metricId: HEALTH_METRIC_IDS.TotalEnergy,
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
        native: expect.objectContaining({ value: 2_478.5, unit: 'calorie' }),
        canonical: null,
      }),
      expect.objectContaining({
        kind: 'sleep_reference',
        metricId: HEALTH_METRIC_IDS.SleepDuration,
        reference: expect.objectContaining({
          documentId: SLEEP_DOCUMENT_ID,
          field: HEALTH_SLEEP_REFERENCE_FIELDS.DurationSeconds,
        }),
      }),
      expect.objectContaining({
        kind: 'sleep_reference',
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        reference: expect.objectContaining({ field: HEALTH_SLEEP_REFERENCE_FIELDS.OvernightHrv }),
      }),
      expect.objectContaining({
        kind: 'sleep_reference',
        metricId: HEALTH_METRIC_IDS.RestingHeartRate,
        semanticVariant: 'daily_resting',
        reference: expect.objectContaining({ field: HEALTH_SLEEP_REFERENCE_FIELDS.RestingHeartRate }),
      }),
    ]));

    const hrvSeries = input.sampleSeries.find(series => series.metricId === HEALTH_METRIC_IDS.HeartRateVariability);
    expect(hrvSeries).toMatchObject({
      semanticVariant: 'overnight_interval',
      offsetMs: [0, 6 * 60 * 60 * 1000],
      canonicalValues: [58, 60],
      coverage: { status: 'unknown', sampleCount: 2 },
    });
    const heartRateSeries = input.sampleSeries.find(series => series.metricId === HEALTH_METRIC_IDS.HeartRate);
    expect(heartRateSeries).toMatchObject({
      semanticVariant: 'hrv_interval_mean',
      offsetMs: [6 * 60 * 60 * 1000, (25 * 60 * 60 * 1000) + (59 * 60 * 1000) + 59_000],
      canonicalValues: [50, 55],
    });
  });

  it('uses direct canonical values when no valid Sleep session can be referenced', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      rhr: 47,
      ppgHrv: 62,
      sleepAvgHr: 51,
    });

    const input = mapCOROSDailyHealth(parsed, 'account', RECEIVED_AT_MS)?.input;

    expect(input?.metrics).toHaveLength(3);
    expect(input?.metrics.every(metric => metric.kind === 'value')).toBe(true);
    expect(mapCOROSDailyHealth(parsed, 'account', RECEIVED_AT_MS)?.observedAtMs)
      .toBe(Date.parse('2026-05-18T00:00:00.000Z') - 1);
    expect(input?.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.RestingHeartRate,
        semanticVariant: 'daily_resting',
        canonical: { value: 47, unit: 'bpm' },
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.HeartRateVariability,
        semanticVariant: 'overnight_average',
        canonical: { value: 62, unit: 'ms' },
      }),
    ]));
    expect(() => validateHealthSourceRecordInput(input)).not.toThrow();
  });

  it('returns no source record for an unrecognized or empty daily row', () => {
    expect(mapCOROSDailyHealth(parseCOROSDailyRecord({ happenDay: 'invalid', step: 10 }), 'account', 1))
      .toBeNull();
    expect(mapCOROSDailyHealth(parseCOROSDailyRecord({ happenDay: '20260517' }), 'account', 1))
      .toBeNull();
  });

  it('produces a stable content token and changes it when recognized content changes', () => {
    const first = parseCOROSDailyRecord({ happenDay: '20260517', step: 10 });
    const equivalent = parseCOROSDailyRecord({ happenDay: 20260517, step: '10' });
    const changed = parseCOROSDailyRecord({ happenDay: '20260517', step: 11 });

    const firstToken = mapCOROSDailyHealth(first, 'account', RECEIVED_AT_MS)?.input.revision.token;
    expect(mapCOROSDailyHealth(equivalent, 'account', RECEIVED_AT_MS)?.input.revision.token).toBe(firstToken);
    expect(mapCOROSDailyHealth(changed, 'account', RECEIVED_AT_MS)?.input.revision.token).not.toBe(firstToken);
  });

  it('does not revise normalized content for ignored out-of-window samples', () => {
    const baseline = parseCOROSDailyRecord({ happenDay: '20260517', step: 10 });
    const withIgnoredSample = parseCOROSDailyRecord({
      happenDay: '20260517',
      step: 10,
      hrvList: [{
        timestamp: Date.parse('2026-05-15T00:00:00.000Z') / 1000,
        hrv: 99,
      }],
    });

    expect(mapCOROSDailyHealth(withIgnoredSample, 'account', RECEIVED_AT_MS)?.input.revision.token)
      .toBe(mapCOROSDailyHealth(baseline, 'account', RECEIVED_AT_MS)?.input.revision.token);
  });

  it('does not reference a Sleep session whose interval exceeds the bounded daily window', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: '2026-05-15 00:00:00',
      sleepEndTime: '2026-05-17 06:00:00',
      rhr: 47,
    });

    const input = mapCOROSDailyHealth(parsed, 'account', RECEIVED_AT_MS, SLEEP_DOCUMENT_ID)?.input;

    expect(input?.metrics).toEqual([
      expect.objectContaining({
        kind: 'value',
        metricId: HEALTH_METRIC_IDS.RestingHeartRate,
      }),
    ]);
    expect(() => validateHealthSourceRecordInput(input)).not.toThrow();
  });

  it('does not reference a Sleep session that ends before the provider day begins', () => {
    const parsed = parseCOROSDailyRecord({
      happenDay: '20260517',
      sleepStartTime: '2026-05-15 23:00:00',
      sleepEndTime: '2026-05-16 07:00:00',
      rhr: 47,
    });

    const input = mapCOROSDailyHealth(parsed, 'account', RECEIVED_AT_MS, SLEEP_DOCUMENT_ID)?.input;

    expect(input?.metrics).toEqual([
      expect.objectContaining({
        kind: 'value',
        metricId: HEALTH_METRIC_IDS.RestingHeartRate,
      }),
    ]);
    expect(() => validateHealthSourceRecordInput(input)).not.toThrow();
  });
});
