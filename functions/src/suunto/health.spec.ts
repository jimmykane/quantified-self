import { describe, expect, it } from 'vitest';
import {
  HEALTH_METRIC_IDS,
  HEALTH_NORMALIZATION_STATUSES,
} from '../../../shared/health';
import { buildHealthSourceRecordWrite } from '../health/writer';
import { validateHealthSourceRecordInput } from '../health/validation';
import {
  assertSuuntoHealthRange,
  assertSuuntoHealthSamplesInRange,
  mapSuuntoActivityHealth,
  mapSuuntoDailyStatisticsHealth,
  mapSuuntoRecoveryHealth,
  parseSuuntoActivitySamples,
  parseSuuntoRecoverySamples,
  SUUNTO_HEALTH_MAX_DAILY_SOURCE_RECORDS,
  SUUNTO_HEALTH_MAX_SERIES_SOURCE_RECORDS,
  SuuntoHealthValidationError,
} from './health';

const ACCOUNT_ID = 'private-suunto-account';
const RECEIVED_AT_MS = Date.parse('2026-08-27T12:00:00.000Z');

describe('Suunto activity Health mapping', () => {
  it('maps all documented measurements with provider-local day boundaries and canonical units', () => {
    const samples = parseSuuntoActivitySamples([
      {
        timestamp: '2026-08-26T23:50:00.000+03:00',
        entryData: {
          HR: 72,
          StepCount: 100,
          EnergyConsumption: 8_368,
          SpO2: 0.97,
          Altitude: 50,
          HRExt: { Min: 60, Max: 80 },
          HRV: 42,
        },
      },
      {
        timestamp: '2026-08-26T23:50:00.000+03:00',
        entryData: {
          HR: 72,
          StepCount: 100,
          EnergyConsumption: 8_368,
          SpO2: 0.97,
          Altitude: 50,
          HRExt: { Min: 60, Max: 80 },
          HRV: 42,
        },
      },
    ]);
    const mapped = mapSuuntoActivityHealth(samples, ACCOUNT_ID, RECEIVED_AT_MS);

    expect(samples).toHaveLength(1);
    expect(mapped).toHaveLength(1);
    const input = validateHealthSourceRecordInput(mapped[0].input);
    expect(input).toMatchObject({
      providerAccountId: ACCOUNT_ID,
      sourceRecordType: 'suunto_247_activity',
      calendarDate: '2026-08-26',
      startTimeMs: Date.parse('2026-08-25T21:00:00.000Z'),
      endTimeMs: Date.parse('2026-08-26T21:00:00.000Z'),
      timezoneOffsetSeconds: 10_800,
      coverage: {
        status: 'unknown',
        sampleCount: 1,
        expectedUpdateIntervalMs: 48 * 60 * 60 * 1000,
      },
    });
    expect(input.sampleSeries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.HeartRate,
        aggregation: 'average',
        canonicalValues: [72],
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.BloodOxygenSaturation,
        nativeValues: [0.97],
        canonicalValues: [97],
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.TotalEnergy,
        nativeValues: [8_368],
        canonicalValues: [2],
      }),
    ]));
    expect(mapped[0].observedAtMs).toBe(Date.parse('2026-08-26T20:50:00.000Z'));
  });

  it('splits a local date when the timezone offset changes', () => {
    const samples = parseSuuntoActivitySamples([
      { timestamp: '2026-10-25T02:50:00.000+03:00', entryData: { HR: 60 } },
      { timestamp: '2026-10-25T03:10:00.000+02:00', entryData: { HR: 62 } },
    ]);

    expect(mapSuuntoActivityHealth(samples, ACCOUNT_ID, RECEIVED_AT_MS)).toHaveLength(2);
  });

  it('rejects activity samples that fan out into too many source records', () => {
    const payload = Array.from({ length: SUUNTO_HEALTH_MAX_SERIES_SOURCE_RECORDS + 1 }, (_, index) => {
      const offsetHours = Math.floor(index / 60);
      const offsetMinutes = index % 60;
      return {
        timestamp: `2026-08-26T12:00:00+${`${offsetHours}`.padStart(2, '0')}:${`${offsetMinutes}`.padStart(2, '0')}`,
        entryData: { HR: 60 },
      };
    });

    expect(() => mapSuuntoActivityHealth(
      parseSuuntoActivitySamples(payload),
      ACCOUNT_ID,
      RECEIVED_AT_MS,
    )).toThrow('bounded source-record count');
  });

  it('merges duplicate timestamps with the final non-null value per field', () => {
    expect(parseSuuntoActivitySamples([
      { timestamp: '2026-08-26T12:00:00Z', entryData: { HR: 60, HRV: 42 } },
      { timestamp: '2026-08-26T12:00:00Z', entryData: { HR: 61 } },
    ])).toEqual([expect.objectContaining({
      heartRateBpm: 61,
      heartRateVariabilityMs: 42,
    })]);
    expect(parseSuuntoRecoverySamples([
      { timestamp: '2026-08-26T12:00:00Z', entryData: { Balance: 0.9, StressState: 3 } },
      { timestamp: '2026-08-26T12:00:00Z', entryData: { Balance: 0.8, StressState: 0 } },
    ])).toEqual([expect.objectContaining({
      balanceRatio: 0.8,
      stressState: 3,
    })]);
    expect(() => parseSuuntoActivitySamples([
      { timestamp: '2026-08-26T12:00:00Z', entryData: { HRExt: { Min: 60, Max: 80 } } },
      { timestamp: '2026-08-26T12:00:00Z', entryData: { HRExt: { Min: 90 } } },
    ])).toThrow('minimum exceeds maximum');
  });

  it('rejects invalid documented ranges', () => {
    expect(() => parseSuuntoActivitySamples([
      { timestamp: '2026-08-26T12:00:00Z', entryData: { SpO2: 1.1 } },
    ])).toThrow(SuuntoHealthValidationError);
  });
});

describe('Suunto recovery Health mapping', () => {
  it('maps Balance and documented StressState categories while omitting the invalid sentinel', () => {
    const samples = parseSuuntoRecoverySamples([
      { timestamp: '2026-08-27T08:00:00Z', entryData: { Balance: 0.93, StressState: 3 } },
      { timestamp: '2026-08-27T09:00:00Z', entryData: { Balance: 0.8, StressState: 0 } },
    ]);
    const input = validateHealthSourceRecordInput(
      mapSuuntoRecoveryHealth(samples, ACCOUNT_ID, RECEIVED_AT_MS)[0].input,
    );

    expect(input.coverage.status).toBe('partial');
    expect(input.sampleSeries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.BodyEnergy,
        nativeValues: [0.93, 0.8],
        canonicalValues: [93, 80],
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.StressState,
        valueType: 'category',
        nativeValues: ['passive'],
        canonicalValues: ['passive'],
        qualityCodes: ['3'],
      }),
    ]));
  });
});

describe('Suunto daily statistics Health mapping', () => {
  const payload = [
    {
      Name: 'energyconsumption',
      Aggregation: 'sum',
      Sources: [{
        Name: 'suunto-247-private-watch-id',
        Samples: [
          { TimeISO8601: '2026-08-26T02:00:00.000', Value: null },
          { TimeISO8601: '2026-08-26T02:00:00.000', Value: 8368 },
        ],
      }],
    },
    {
      Name: 'stepcount',
      Aggregation: 'sum',
      Sources: [{
        Name: 'suunto-247-private-watch-id',
        Samples: [{ TimeISO8601: '2026-08-26T02:00:00.000', Value: '4617' }],
      }],
    },
  ];

  it('maps authoritative totals and hashes device attribution before persistence', async () => {
    const mapped = mapSuuntoDailyStatisticsHealth(payload, ACCOUNT_ID, RECEIVED_AT_MS);
    expect(mapped).toHaveLength(1);
    const input = validateHealthSourceRecordInput(mapped[0].input);

    expect(input).toMatchObject({
      startTimeMs: Date.parse('2026-08-26T02:00:00.000Z'),
      endTimeMs: Date.parse('2026-08-27T02:00:00.000Z'),
      coverage: {
        expectedStartTimeMs: Date.parse('2026-08-26T02:00:00.000Z'),
        expectedEndTimeMs: Date.parse('2026-08-27T02:00:00.000Z'),
      },
    });
    expect(input.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.Steps,
        aggregation: 'total',
        canonical: { value: 4617, unit: 'count' },
      }),
      expect.objectContaining({
        metricId: HEALTH_METRIC_IDS.TotalEnergy,
        aggregation: 'total',
        normalizationStatus: HEALTH_NORMALIZATION_STATUSES.Canonical,
        native: expect.objectContaining({ value: 8368, unit: 'J' }),
        canonical: { value: 2, unit: 'kcal' },
      }),
    ]));
    expect(input.device?.deviceKey).toMatch(/^[a-f0-9]{64}$/);
    expect(input.device?.deviceKey).not.toContain('private-watch-id');

    const built = await buildHealthSourceRecordWrite('firebase-user', input, RECEIVED_AT_MS);
    expect(JSON.stringify(built)).not.toContain(ACCOUNT_ID);
    expect(JSON.stringify(built)).not.toContain('suunto-247-private-watch-id');
  });

  it('rejects conflicting non-null values for the same source and date', () => {
    expect(() => mapSuuntoDailyStatisticsHealth([{
      Name: 'stepcount',
      Aggregation: 'sum',
      Sources: [{
        Name: 'watch',
        Samples: [
          { TimeISO8601: '2026-08-26T02:00:00.000', Value: 10 },
          { TimeISO8601: '2026-08-26T02:00:00.000', Value: 11 },
        ],
      }],
    }], ACCOUNT_ID, RECEIVED_AT_MS)).toThrow(SuuntoHealthValidationError);
  });

  it('keeps daily revisions stable when provider aggregation groups are reordered', () => {
    const aggregationPayload = [
      {
        Name: 'stepcount',
        Aggregation: 'sum',
        Sources: [{
          Name: 'watch',
          Samples: [{ TimeISO8601: '2026-08-26T02:00:00.000', Value: 4617 }],
        }],
      },
      {
        Name: 'stepcount',
        Aggregation: 'avg',
        Sources: [{
          Name: 'watch',
          Samples: [{ TimeISO8601: '2026-08-26T02:00:00.000', Value: 192 }],
        }],
      },
    ];

    const original = mapSuuntoDailyStatisticsHealth(aggregationPayload, ACCOUNT_ID, RECEIVED_AT_MS);
    const reordered = mapSuuntoDailyStatisticsHealth([...aggregationPayload].reverse(), ACCOUNT_ID, RECEIVED_AT_MS);

    expect(reordered[0].input.revision.token).toBe(original[0].input.revision.token);
    expect(reordered[0].input.metrics.map(metric => metric.aggregation)).toEqual(['average', 'total']);
  });

  it('rejects daily-statistics payloads that fan out into too many source records', () => {
    const sourcesPerGroup = 64;
    const groupCount = Math.floor(SUUNTO_HEALTH_MAX_DAILY_SOURCE_RECORDS / sourcesPerGroup) + 1;
    const oversizedPayload = Array.from({ length: groupCount }, (_, groupIndex) => ({
      Name: 'stepcount',
      Aggregation: 'sum',
      Sources: Array.from({ length: sourcesPerGroup }, (_, sourceIndex) => ({
        Name: `watch-${groupIndex}-${sourceIndex}`,
        Samples: [{ TimeISO8601: '2026-08-26T00:00:00Z', Value: 1 }],
      })),
    }));

    expect(() => mapSuuntoDailyStatisticsHealth(
      oversizedPayload,
      ACCOUNT_ID,
      RECEIVED_AT_MS,
    )).toThrow('bounded source-record count');
  });
});

describe('Suunto Health request bounds', () => {
  it('enforces half-open ranges of at most 28 days', () => {
    const startMs = Date.parse('2026-08-01T00:00:00Z');
    const endMs = Date.parse('2026-08-29T00:00:00Z');
    expect(assertSuuntoHealthRange(startMs, endMs)).toEqual({ startMs, endMs });
    expect(() => assertSuuntoHealthRange(startMs, endMs + 1)).toThrow(SuuntoHealthValidationError);
    expect(() => assertSuuntoHealthRange(endMs, startMs)).toThrow(SuuntoHealthValidationError);
    expect(() => assertSuuntoHealthRange(
      Number.MAX_SAFE_INTEGER - 1_000,
      Number.MAX_SAFE_INTEGER,
    )).toThrow(SuuntoHealthValidationError);
  });

  it('rejects provider samples outside the requested half-open range', () => {
    const samples = parseSuuntoRecoverySamples([
      { timestamp: '2026-08-02T00:00:00Z', entryData: { Balance: 0.5 } },
    ]);
    expect(() => assertSuuntoHealthSamplesInRange(
      samples,
      Date.parse('2026-08-02T00:00:01Z'),
      Date.parse('2026-08-03T00:00:00Z'),
      'Suunto recovery',
    )).toThrow(SuuntoHealthValidationError);
  });
});
