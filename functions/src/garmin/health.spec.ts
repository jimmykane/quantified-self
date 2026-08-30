import { describe, expect, it } from 'vitest';
import {
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
  HEALTH_RECORDING_METHODS,
  HEALTH_UNITS,
} from '../../../shared/health';
import { validateHealthSourceRecordInput } from '../health/validation';
import {
  GARMIN_HEALTH_MAX_SUMMARIES_PER_CALLBACK,
  GarminHealthValidationError,
  mapGarminHealthSummaries,
} from './health';

const PROVIDER_ACCOUNT_ID = 'garmin-account-1';
const REVISION_ORDER = 1_760_003_600_000;
const RECEIVED_AT_MS = 1_760_003_700_000;

function map(type: Parameters<typeof mapGarminHealthSummaries>[0], payload: unknown[]) {
  const results = mapGarminHealthSummaries(
    type,
    payload,
    PROVIDER_ACCOUNT_ID,
    REVISION_ORDER,
    RECEIVED_AT_MS,
  );
  results.forEach(result => expect(() => validateHealthSourceRecordInput(result.input)).not.toThrow());
  return results;
}

describe('Garmin Health API summary mapping', () => {
  it('accepts more than one worker write batch without truncating the callback', () => {
    const results = map('bodyComps', Array.from({ length: 129 }, (_, index) => ({
      summaryId: `body-${index}`,
      measurementTimeInSeconds: 1_760_000_000 + index,
      weightInGrams: 70_000 + index,
    })));

    expect(results).toHaveLength(129);
  });

  it('rejects callback collections above the provider-response count bound', () => {
    expect(() => mapGarminHealthSummaries(
      'dailies',
      Array.from({ length: GARMIN_HEALTH_MAX_SUMMARIES_PER_CALLBACK + 1 }, () => ({})),
      PROVIDER_ACCOUNT_ID,
      REVISION_ORDER,
      RECEIVED_AT_MS,
    )).toThrow('dailies response exceeds the bounded summary count.');
  });

  it('maps Daily summaries without treating the rolling seven-day heart rate as a daily average', () => {
    const [result] = map('dailies', [{
      summaryId: 'daily-summary-1',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: 3_600,
      durationInSeconds: 86_400,
      steps: 4_210,
      stepsGoal: 5_000,
      pushes: 10,
      pushesGoal: 100,
      distanceInMeters: 3_146.5,
      pushDistanceInMeters: 32.5,
      floorsClimbed: 8,
      floorsClimbedGoal: 10,
      activeTimeInSeconds: 12_240,
      moderateIntensityDurationInSeconds: 1_800,
      vigorousIntensityDurationInSeconds: 600,
      intensityDurationGoalInSeconds: 1_500,
      activeKilocalories: 321,
      bmrKilocalories: 1_731,
      minHeartRateInBeatsPerMinute: 59,
      averageHeartRateInBeatsPerMinute: 64,
      maxHeartRateInBeatsPerMinute: 112,
      restingHeartRateInBeatsPerMinute: 61,
      timeOffsetHeartRateSamples: { 15: 75, 30: 72 },
      averageStressLevel: 43,
      maxStressLevel: 87,
      stressDurationInSeconds: 13_620,
      restStressDurationInSeconds: 7_600,
      lowStressDurationInSeconds: 6_700,
      stressQualifier: 'stressful_awake',
      bodyBatteryChargedValue: 35,
      bodyBatteryDrainedValue: 42,
    }]);

    expect(result.input.sourceRecordKey).toBe('1760000000000');
    expect(result.input.revision.order).toBe(REVISION_ORDER);
    expect(result.input.revision.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.input.revision.token).not.toContain('daily-summary-1');
    expect(result.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.Steps,
        goal: expect.objectContaining({ canonical: { value: 5_000, unit: HEALTH_UNITS.Count } }),
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.HeartRate,
        aggregation: 'average',
        semanticVariant: 'rolling_7_day_average',
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.BodyEnergyChange,
        semanticVariant: 'daily_charged',
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
      }),
    ]));
    expect(result.input.sampleSeries[0]).toMatchObject({
      metricId: HEALTH_METRIC_IDS.HeartRate,
      offsetMs: [15_000, 30_000],
      canonicalValues: [75, 72],
    });
  });

  it('separates numeric Stress samples, measurement-state codes, Body Battery, and events', () => {
    const [result] = map('stressDetails', [{
      summaryId: 'stress-1',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: 0,
      durationInSeconds: 540,
      timeOffsetStressLevelValues: { 0: 18, 180: -1, 360: -4, 540: 51 },
      timeOffsetBodyBatteryValues: { 0: 55, 180: 56, 360: 59 },
      bodyBatteryDynamicFeedbackEvent: {
        eventStartTimeInSeconds: 1_760_000_360,
        bodyBatteryLevel: 'MODERATE',
      },
      bodyBatteryActivityEvents: [{
        eventType: 'RECOVERY',
        eventStartTimeInSeconds: -1_760_000_180,
        eventStartTimeOffsetInSeconds: 0,
        duration: 180,
        bodyBatteryImpact: 3,
      }],
    }]);

    expect(result.input.sampleSeries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        seriesKey: 'stress_level_3_minute_average',
        nativeValues: [18, 51],
      }),
      expect.objectContaining({
        seriesKey: 'stress_measurement_state',
        nativeValues: ['-1', '-4'],
        canonicalValues: ['off_wrist', 'recovering_from_exercise'],
      }),
      expect.objectContaining({
        seriesKey: 'garmin_body_battery',
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.NativeOnly,
      }),
    ]));
    expect(result.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.BodyEnergy,
        native: expect.objectContaining({
          qualifiers: expect.objectContaining({ dynamicFeedbackLevel: 'MODERATE' }),
        }),
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.BodyEnergyChange,
        semanticVariant: 'garmin_recovery',
        native: expect.objectContaining({
          qualifiers: expect.objectContaining({
            eventStartTimeInSeconds: -1_760_000_180,
          }),
        }),
      }),
    ]));
  });

  it('caps Body Battery activity events within the shared metric write budget', () => {
    const bodyBatteryActivityEvents = Array.from({ length: 256 }, (_, index) => ({
      eventType: 'ACTIVITY',
      eventStartTimeInSeconds: index - 128,
      eventStartTimeOffsetInSeconds: 0,
      duration: 60,
      bodyBatteryImpact: -1,
    }));
    const [result] = map('stressDetails', [{
      summaryId: 'stress-event-budget',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: 0,
      durationInSeconds: 540,
      timeOffsetBodyBatteryValues: { 0: 55 },
      bodyBatteryDynamicFeedbackEvent: {
        eventStartTimeInSeconds: 1_760_000_360,
        bodyBatteryLevel: 'MODERATE',
      },
      bodyBatteryActivityEvents,
    }]);

    expect(result.input.metrics).toHaveLength(128);
    expect(result.input.metrics.at(-1)).toMatchObject({
      native: {
        qualifiers: {
          bodyBatteryActivityEventsTruncated: true,
          bodyBatteryActivityEventCount: 256,
        },
      },
    });
  });

  it.each([undefined, null])('accepts an omitted Body Battery event duration (%s)', duration => {
    const [result] = map('stressDetails', [{
      summaryId: 'stress-optional-event-duration',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: 0,
      durationInSeconds: 540,
      bodyBatteryActivityEvents: [{
        eventType: 'RECOVERY',
        eventStartTimeInSeconds: -1_760_000_180,
        eventStartTimeOffsetInSeconds: 0,
        duration,
        bodyBatteryImpact: 3,
      }],
    }]);

    expect(result.input.metrics).toEqual([
      expect.objectContaining({
        native: expect.objectContaining({
          qualifiers: expect.objectContaining({
            durationSeconds: null,
          }),
        }),
      }),
    ]);
  });

  it('still rejects an invalid provided Body Battery event duration', () => {
    expect(() => map('stressDetails', [{
      summaryId: 'stress-invalid-event-duration',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: 0,
      durationInSeconds: 540,
      bodyBatteryActivityEvents: [{
        eventType: 'RECOVERY',
        eventStartTimeInSeconds: -1_760_000_180,
        eventStartTimeOffsetInSeconds: 0,
        duration: -1,
        bodyBatteryImpact: 3,
      }],
    }])).toThrow('bodyBatteryActivityEvents[0].duration is outside the supported numeric range');
  });

  it('still validates Body Battery events that exceed the emitted metric budget', () => {
    const bodyBatteryActivityEvents = Array.from({ length: 129 }, (_, index) => ({
      eventType: index === 128 ? 'UNKNOWN' : 'ACTIVITY',
      eventStartTimeInSeconds: index - 64,
      eventStartTimeOffsetInSeconds: 0,
      duration: 60,
      bodyBatteryImpact: -1,
    }));

    expect(() => mapGarminHealthSummaries(
      'stressDetails',
      [{
        summaryId: 'stress-invalid-truncated-event',
        calendarDate: '2025-10-09',
        startTimeInSeconds: 1_760_000_000,
        startTimeOffsetInSeconds: 0,
        durationInSeconds: 540,
        bodyBatteryActivityEvents,
      }],
      PROVIDER_ACCOUNT_ID,
      REVISION_ORDER,
      RECEIVED_AT_MS,
    )).toThrow(GarminHealthValidationError);
  });

  it('maps overnight HRV aggregates and five-minute RMSSD samples', () => {
    const [result] = map('hrv', [{
      summaryId: 'hrv-1',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: -18_000,
      durationInSeconds: 3_820,
      lastNightAvg: 44,
      lastNight5MinHigh: 72,
      hrvValues: { 300: 32, 600: 24 },
    }]);

    expect(result.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticVariant: 'overnight_rmssd', canonical: { value: 44, unit: HEALTH_UNITS.Millisecond } }),
      expect.objectContaining({ semanticVariant: 'overnight_5_minute_high_rmssd', canonical: { value: 72, unit: HEALTH_UNITS.Millisecond } }),
    ]));
    expect(result.input.sampleSeries[0].offsetMs).toEqual([300_000, 600_000]);
  });

  it('keeps running and cycling VO2 max distinct and keys User Metrics by calendar date', () => {
    const [result] = map('userMetrics', [{
      summaryId: 'metrics-1',
      calendarDate: '2025-10-09',
      vo2Max: 48,
      vo2MaxCycling: 51,
      enhanced: true,
      fitnessAge: 32,
    }]);

    expect(result.input.sourceRecordKey).toBe('2025-10-09');
    expect(result.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.Vo2Max, semanticVariant: 'running' }),
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.Vo2Max, semanticVariant: 'cycling' }),
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.FitnessAge, semanticVariant: 'enhanced' }),
    ]));
  });

  it('converts Garmin body-composition grams to kilograms and distinguishes manual weight', () => {
    const [deviceResult] = map('bodyComps', [{
      summaryId: 'body-1',
      measurementTimeInSeconds: 1_760_000_000,
      measurementTimeOffsetInSeconds: 0,
      weightInGrams: 75_450,
      muscleMassInGrams: 25_478,
      boneMassInGrams: 2_437,
      bodyWaterInPercent: 59.4,
      bodyFatInPercent: 17.1,
      bodyMassIndex: 23.2,
    }]);
    const [manualResult] = map('bodyComps', [{
      summaryId: 'body-2',
      measurementTimeInSeconds: 1_760_000_100,
      weightInGrams: 75_000,
    }]);

    expect(deviceResult.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.BodyWeight,
        canonical: { value: 75.45, unit: HEALTH_UNITS.Kilogram },
        recordingMethod: HEALTH_RECORDING_METHODS.Device,
      }),
    ]));
    expect(manualResult.input.metrics[0]).toMatchObject({
      recordingMethod: HEALTH_RECORDING_METHODS.Manual,
      canonical: { value: 75, unit: HEALTH_UNITS.Kilogram },
    });
  });

  it('keeps continuous and on-demand Pulse Ox summaries with the same start separate', () => {
    const results = map('pulseox', [{
      summaryId: 'pulseox-continuous',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: 3_600,
      durationInSeconds: 86_400,
      timeOffsetSpo2Values: { 60: 96 },
      onDemand: false,
    }, {
      summaryId: 'pulseox-spot',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: 3_600,
      durationInSeconds: 0,
      timeOffsetSpo2Values: { 55_740: 93 },
      onDemand: true,
    }]);

    expect(results.map(result => result.input.sourceRecordKey)).toEqual([
      '1760000000000:continuous',
      '1760000000000:on_demand',
    ]);
    expect(results[1].input.endTimeMs).toBe(1_760_055_740_000);
    expect(results[1].input.sampleSeries[0].semanticVariant).toBe('on_demand_exact');
  });

  it('preserves Garmin timestamps supplied with millisecond precision', () => {
    const [result] = map('pulseox', [{
      summaryId: 'pulseox-fractional-start',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000.125,
      startTimeOffsetInSeconds: 3_600,
      durationInSeconds: 60,
      timeOffsetSpo2Values: { 0: 96 },
      onDemand: false,
    }]);

    expect(result.input.startTimeMs).toBe(1_760_000_000_125);
    expect(result.input.sourceRecordKey).toBe('1760000000125:continuous');
  });

  it('maps all-day respiration samples', () => {
    const [result] = map('allDayRespiration', [{
      summaryId: 'respiration-1',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: -18_000,
      durationInSeconds: 900,
      timeOffsetEpochToBreaths: { 0: 14.63, 60: 14.4 },
    }]);

    expect(result.input.sampleSeries[0]).toMatchObject({
      metricId: HEALTH_METRIC_IDS.RespirationRate,
      canonicalUnit: HEALTH_UNITS.BreathsPerMinute,
      canonicalValues: [14.63, 14.4],
    });
  });

  it('maps blood pressure source method and skin-temperature deviation', () => {
    const [bloodPressure] = map('bloodPressures', [{
      summaryId: 'bp-1',
      measurementTimeInSeconds: 1_760_000_000,
      measurementTimeOffsetInSeconds: -18_000,
      systolic: 120,
      diastolic: 80,
      pulse: 62,
      sourceType: 'MANUAL',
    }]);
    const [skinTemperature] = map('skinTemp', [{
      summaryId: 'skin-1',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      startTimeOffsetInSeconds: -21_600,
      durationInSeconds: 1_980,
      avgDeviationCelsius: -1.6,
    }]);

    expect(bloodPressure.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.BloodPressureSystolic, recordingMethod: HEALTH_RECORDING_METHODS.Manual }),
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.BloodPressureDiastolic, recordingMethod: HEALTH_RECORDING_METHODS.Manual }),
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.PulseRate, recordingMethod: HEALTH_RECORDING_METHODS.Manual }),
    ]));
    expect(skinTemperature.input.metrics[0]).toMatchObject({
      metricId: HEALTH_METRIC_IDS.SkinTemperatureDeviation,
      semanticVariant: 'sleep_window_deviation',
      canonical: { value: -1.6, unit: HEALTH_UNITS.Celsius },
    });
  });

  it('maps Health Snapshot aggregates, samples, RMSSD, and SDRR distinctly', () => {
    const [result] = map('healthSnapshot', [{
      summaryId: 'snapshot-1',
      calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000,
      offsetStartTimeInSeconds: 7_200,
      durationInSeconds: 120,
      summaries: [{
        summaryType: 'heart_rate', minValue: 78, maxValue: 87, avgValue: 83,
        epochSummaries: { 0: 84, 120: 85 },
      }, {
        summaryType: 'rmssd_hrv', avgValue: 20,
      }, {
        summaryType: 'sdrr_hrv', avgValue: 32,
      }],
    }]);

    expect(result.input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.HeartRate, aggregation: 'average' }),
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.HeartRateVariability, semanticVariant: 'health_snapshot_rmssd' }),
      expect.objectContaining({ metricId: HEALTH_METRIC_IDS.HeartRateVariability, semanticVariant: 'health_snapshot_sdrr' }),
    ]));
    expect(result.input.sampleSeries[0]).toMatchObject({
      seriesKey: 'health_snapshot_heart_rate',
      canonicalValues: [84, 85],
    });
  });

  it('accepts Garmin\'s inclusive final Health Snapshot epoch and extends the record end', () => {
    const startTimeInSeconds = 1_760_000_000;
    const [result] = map('healthSnapshot', [{
      summaryId: 'snapshot-inclusive-end',
      calendarDate: '2025-10-09',
      startTimeInSeconds,
      offsetStartTimeInSeconds: 7_200,
      durationInSeconds: 119,
      summaries: [{
        summaryType: 'heart_rate',
        epochSummaries: { 0: 84, 120: 85 },
      }],
    }]);

    expect(result.input.endTimeMs).toBe((startTimeInSeconds + 120) * 1_000);
    expect(result.input.coverage).toMatchObject({
      expectedEndTimeMs: (startTimeInSeconds + 120) * 1_000,
      observedDurationSeconds: 120,
      expectedDurationSeconds: 120,
    });
    expect(result.input.sampleSeries[0].offsetMs).toEqual([0, 120_000]);
  });

  it('keeps the last row for duplicate identities in the same callback', () => {
    const results = map('userMetrics', [{
      summaryId: 'metrics-1', calendarDate: '2025-10-09', vo2Max: 47,
    }, {
      summaryId: 'metrics-2', calendarDate: '2025-10-09', vo2Max: 49,
    }]);

    expect(results).toHaveLength(1);
    expect(results[0].input.metrics[0]).toMatchObject({ canonical: { value: 49, unit: HEALTH_UNITS.MillilitersPerKilogramPerMinute } });
  });

  it('keeps revision tokens stable when Garmin replaces only the summary ID', () => {
    const first = map('userMetrics', [{
      summaryId: 'metrics-original', calendarDate: '2025-10-09', vo2Max: 49,
    }])[0];
    const replacement = map('userMetrics', [{
      summaryId: 'metrics-replacement', calendarDate: '2025-10-09', vo2Max: 49,
    }])[0];

    expect(replacement.input.sourceRecordKey).toBe(first.input.sourceRecordKey);
    expect(replacement.input.revision.token).toBe(first.input.revision.token);
  });

  it('rounds documented fractional-second timestamps to model millisecond precision', () => {
    const [result] = map('healthSnapshot', [{
      summaryId: 'snapshot-1', calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000.0001, startTimeOffsetInSeconds: 0,
      durationInSeconds: 120,
      summaries: [{ summaryType: 'heart_rate', avgValue: 70 }],
    }]);

    expect(result.input.startTimeMs).toBe(1_760_000_000_000);
  });

  it.each([
    ['mismatched account', 'dailies', [{
      summaryId: 'daily-1', userId: 'other-account', calendarDate: '2025-10-09',
      startTimeInSeconds: 1_760_000_000, durationInSeconds: 1,
    }]],
    ['out-of-range Daily sample', 'dailies', [{
      summaryId: 'daily-1', calendarDate: '2025-10-09', startTimeInSeconds: 1_760_000_000,
      durationInSeconds: 60, timeOffsetHeartRateSamples: { 61: 70 },
    }]],
    ['unsupported stress code', 'stressDetails', [{
      summaryId: 'stress-1', calendarDate: '2025-10-09', startTimeInSeconds: 1_760_000_000,
      durationInSeconds: 60, timeOffsetStressLevelValues: { 0: 0 },
    }]],
    ['nonzero on-demand duration', 'pulseox', [{
      summaryId: 'pulse-1', calendarDate: '2025-10-09', startTimeInSeconds: 1_760_000_000,
      durationInSeconds: 60, onDemand: true, timeOffsetSpo2Values: { 0: 96 },
    }]],
    ['Snapshot sample beyond the inclusive endpoint', 'healthSnapshot', [{
      summaryId: 'snapshot-1', calendarDate: '2025-10-09', startTimeInSeconds: 1_760_000_000,
      durationInSeconds: 119,
      summaries: [{ summaryType: 'heart_rate', epochSummaries: { 121: 70 } }],
    }]],
  ] as const)('rejects %s', (_caseName, type, payload) => {
    expect(() => mapGarminHealthSummaries(
      type,
      payload,
      PROVIDER_ACCOUNT_ID,
      REVISION_ORDER,
      RECEIVED_AT_MS,
    )).toThrow(GarminHealthValidationError);
  });
});
