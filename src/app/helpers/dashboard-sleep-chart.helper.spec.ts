import { describe, expect, it } from 'vitest';
import {
  groupCanonicalSleepNightFragments,
  parseSleepDateTimeOffsetSeconds,
  resolveSleepDisplayDate,
  SLEEP_PROVIDERS,
} from '@shared/sleep';
import { buildDashboardSleepTrendContext, formatSleepDuration } from './dashboard-sleep-chart.helper';

function expectedSleepDateLabel(sleepDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${sleepDate}T00:00:00.000Z`));
}

describe('dashboard-sleep-chart.helper', () => {
  it('shares one bounded provider-night identity and wake-date rule', () => {
    const base = {
      provider: SLEEP_PROVIDERS.SuuntoApp,
      providerUserId: 'suunto-user',
      sleepDate: '2026-09-28',
      isNap: false,
    };
    const input = [
      { ...base, id: 'first', startTimeMs: 1_000, endTimeMs: 2_000 },
      { ...base, id: 'second', startTimeMs: 2_000 + (30 * 60 * 1000), endTimeMs: 3_000 + (30 * 60 * 1000) },
      { ...base, id: 'separate', startTimeMs: 3_000 + (61 * 60 * 1000), endTimeMs: 4_000 + (61 * 60 * 1000) },
      { ...base, id: 'unidentified', providerUserId: null, startTimeMs: 1_500, endTimeMs: 2_500 },
      { ...base, id: 'nap', isNap: true, startTimeMs: 1_500, endTimeMs: 2_500 },
    ];

    expect(groupCanonicalSleepNightFragments(input).map(group => group.map(item => item.id))).toEqual([
      ['first', 'second'],
      ['separate'],
      ['unidentified'],
      ['nap'],
    ]);
    const session = {
      source: { provider: SLEEP_PROVIDERS.SuuntoApp, providerUserId: 'suunto-user', sourceSessionKey: 'sleep' },
      sleepDate: '2026-09-27',
      startTimeMs: Date.parse('2026-09-27T18:57:00Z'),
      endTimeMs: Date.parse('2026-09-28T04:00:00Z'),
      isNap: false,
      timezoneOffsetSeconds: Number.MAX_SAFE_INTEGER,
      providerFields: { suunto: { timestamp: '2026-09-28T07:00:00+03:00' } },
    };
    expect(resolveSleepDisplayDate(session)).toBe('2026-09-28');
    expect(resolveSleepDisplayDate({
      ...session,
      sleepDate: '2026-09-27',
      timezoneOffsetSeconds: null,
      providerFields: null,
    })).toBe('2026-09-27');
    expect(parseSleepDateTimeOffsetSeconds('2026-09-28T07:00:00+19:00')).toBeNull();
    expect(resolveSleepDisplayDate({
      ...session,
      sleepDate: 'not-a-date',
      endTimeMs: Date.parse('2026-09-28T04:00:00Z'),
      timezoneOffsetSeconds: null,
      providerFields: null,
    })).toBeNull();
    expect(resolveSleepDisplayDate({
      ...session,
      sleepDate: '',
      endTimeMs: Number.MAX_SAFE_INTEGER,
    })).toBeNull();
  });

  it('builds stacked sleep points for staged provider sessions', () => {
    const context = buildDashboardSleepTrendContext([{
      id: 'garmin-sleep-1',
      startTimeMs: Date.UTC(2026, 0, 2, 22),
      endTimeMs: Date.UTC(2026, 0, 3, 6),
      sleepDate: '2026-01-03',
      durationSeconds: 8 * 3600,
      stageDurationsSeconds: {
        deep: 2 * 3600,
        light: 4 * 3600,
        rem: 90 * 60,
        awake: 30 * 60,
      },
      score: { value: 84, qualifier: 'good' },
      vitals: {
        averageHeartRateBpm: 48,
        overnightHrvMs: 67,
      },
      spo2Samples: [{ value: 95 }, { value: 98 }],
      source: { provider: 'GarminAPI', sourceSessionKey: 'garmin-source-1' },
    } as any]);

    expect(context.points).toHaveLength(1);
    expect(context.points[0]).toMatchObject({
      providerLabel: 'Garmin',
      sleepDate: '2026-01-03',
      deepSeconds: 7200,
      lightSeconds: 14400,
      remSeconds: 5400,
      awakeSeconds: 1800,
      score: 84,
      averageHeartRateBpm: 48,
      averageHrvMs: 67,
      maxSpo2Percent: 98,
    });
    expect(context.points[0].categoryLabel).toBe(expectedSleepDateLabel('2026-01-03'));
    expect(context.points[0].unknownSeconds).toBe(0);
    expect(context.latestPoint?.id).toBe('garmin-sleep-1');
  });

  it('keeps COROS no-stage sessions renderable as unknown sleep', () => {
    const context = buildDashboardSleepTrendContext([{
      id: 'coros-sleep-1',
      startTimeMs: Date.UTC(2026, 0, 3, 21),
      endTimeMs: Date.UTC(2026, 0, 4, 4),
      sleepDate: '2026-01-04',
      durationSeconds: 7 * 3600,
      source: { provider: 'COROSAPI', sourceSessionKey: 'coros-source-1' },
    } as any]);

    expect(context.points[0]).toMatchObject({
      providerLabel: 'COROS',
      unknownSeconds: 7 * 3600,
      deepSeconds: 0,
      lightSeconds: 0,
      remSeconds: 0,
    });
  });

  it('hides redundant provider labels when all visible sleep points use one source', () => {
    const context = buildDashboardSleepTrendContext([
      {
        id: 'suunto-sleep-1',
        startTimeMs: Date.UTC(2026, 0, 3, 21),
        endTimeMs: Date.UTC(2026, 0, 4, 4),
        sleepDate: '2026-01-04',
        durationSeconds: 7 * 3600,
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-source-1' },
      },
      {
        id: 'suunto-sleep-2',
        startTimeMs: Date.UTC(2026, 0, 4, 22),
        endTimeMs: Date.UTC(2026, 0, 5, 5),
        sleepDate: '2026-01-05',
        durationSeconds: 7 * 3600,
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-source-2' },
      },
    ] as any[]);

    expect(context.points.map(point => point.providerLabel)).toEqual(['Suunto', 'Suunto']);
    expect(context.points.map(point => point.categoryLabel)).toEqual([
      expectedSleepDateLabel('2026-01-04'),
      expectedSleepDateLabel('2026-01-05'),
    ]);
    expect(context.points.every(point => !point.categoryLabel.includes('Suunto'))).toBe(true);
    expect(context.points.every(point => !point.categoryLabel.includes('\n'))).toBe(true);
  });

  it('keys Suunto sleep by local wake date while keeping naps on the nap date', () => {
    const context = buildDashboardSleepTrendContext([
      {
        id: 'suunto-previous-overnight',
        startTimeMs: Date.UTC(2026, 4, 25, 18, 29),
        endTimeMs: Date.UTC(2026, 4, 26, 1, 18),
        sleepDate: '2026-05-25',
        durationSeconds: 23580,
        isNap: false,
        vitals: {
          averageHeartRateBpm: 65,
          minimumHeartRateBpm: 49,
          averageHrvMs: 31,
        },
        providerFields: {
          suunto: {
            timestamp: '2026-05-25T21:29:00.000+03:00',
          },
        },
        source: { provider: 'SuuntoApp', providerUserId: 'suunto-user', sourceSessionKey: 'suunto-previous-overnight-source' },
      },
      {
        id: 'suunto-nap',
        startTimeMs: Date.UTC(2026, 4, 26, 2),
        endTimeMs: Date.UTC(2026, 4, 26, 4, 52),
        sleepDate: '2026-05-26',
        durationSeconds: 10320,
        isNap: true,
        vitals: {
          averageHeartRateBpm: 56,
          minimumHeartRateBpm: 48,
          averageHrvMs: 45,
        },
        providerFields: {
          suunto: {
            timestamp: '2026-05-26T05:00:00.000+03:00',
          },
        },
        source: { provider: 'SuuntoApp', providerUserId: 'suunto-user', sourceSessionKey: 'suunto-nap-source' },
      },
      {
        id: 'suunto-next-overnight',
        startTimeMs: Date.UTC(2026, 4, 26, 18, 47),
        endTimeMs: Date.UTC(2026, 4, 27, 4, 38),
        sleepDate: '2026-05-26',
        durationSeconds: 33300,
        isNap: false,
        vitals: {
          averageHeartRateBpm: 64,
          minimumHeartRateBpm: 47,
          averageHrvMs: 32,
        },
        providerFields: {
          suunto: {
            timestamp: '2026-05-26T21:47:00.000+03:00',
          },
        },
        source: { provider: 'SuuntoApp', providerUserId: 'suunto-user', sourceSessionKey: 'suunto-next-overnight-source' },
      },
    ] as any[]);

    expect(context.points).toHaveLength(2);
    expect(context.points[0]).toMatchObject({
      categoryLabel: expectedSleepDateLabel('2026-05-26'),
      sleepDate: '2026-05-26',
      totalSeconds: 23580,
      napSeconds: 10320,
      napCount: 1,
      napStartTimeMs: Date.UTC(2026, 4, 26, 2),
      napEndTimeMs: Date.UTC(2026, 4, 26, 4, 52),
      averageHeartRateBpm: 65,
      minimumHeartRateBpm: 49,
      averageHrvMs: 31,
      napAverageHeartRateBpm: 56,
      napAverageHrvMs: 45,
      isNap: false,
    });
    expect(context.points[0].categoryLabel).not.toContain('Suunto');
    expect(context.points[1]).toMatchObject({
      categoryLabel: expectedSleepDateLabel('2026-05-27'),
      sleepDate: '2026-05-27',
      totalSeconds: 33300,
      napSeconds: 0,
      averageHeartRateBpm: 64,
      minimumHeartRateBpm: 47,
      averageHrvMs: 32,
      isNap: false,
    });
    expect(context.latestPoint?.id).toBe('suunto-next-overnight');
  });

  it('derives the latest sleep point by session time instead of provider display order', () => {
    const context = buildDashboardSleepTrendContext([
      {
        id: 'garmin-later-sleep',
        startTimeMs: Date.UTC(2026, 0, 5, 23),
        endTimeMs: Date.UTC(2026, 0, 6, 7),
        sleepDate: '2026-01-06',
        durationSeconds: 8 * 3600,
        source: { provider: 'GarminAPI', sourceSessionKey: 'garmin-source-2' },
      },
      {
        id: 'suunto-earlier-sleep',
        startTimeMs: Date.UTC(2026, 0, 5, 21),
        endTimeMs: Date.UTC(2026, 0, 6, 5),
        sleepDate: '2026-01-06',
        durationSeconds: 8 * 3600,
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-source-1' },
      },
    ] as any[]);

    expect(context.points.map((point) => point.id)).toEqual([
      'garmin-later-sleep',
      'suunto-earlier-sleep',
    ]);
    expect(context.points.map((point) => point.categoryLabel)).toEqual([
      `${expectedSleepDateLabel('2026-01-06')}\nGarmin`,
      `${expectedSleepDateLabel('2026-01-06')}\nSuunto`,
    ]);
    expect(context.latestPoint?.id).toBe('garmin-later-sleep');
  });

  it('selects and identifies tied same-night records deterministically', () => {
    const buildSession = (id: string, score: number) => ({
      id,
      startTimeMs: Date.UTC(2026, 0, 5, 22),
      endTimeMs: Date.UTC(2026, 0, 6, 6),
      sleepDate: '2026-01-06',
      durationSeconds: 8 * 3600,
      score: { value: score },
      source: { provider: 'GarminAPI', sourceSessionKey: id },
    });

    const forward = buildDashboardSleepTrendContext([
      buildSession('alpha', 70),
      buildSession('zulu', 90),
    ] as any[]);
    const reverse = buildDashboardSleepTrendContext([
      buildSession('zulu', 90),
      buildSession('alpha', 70),
    ] as any[]);

    expect(forward.points[0]).toMatchObject({ id: 'alpha|zulu', score: 90 });
    expect(reverse.points[0]).toMatchObject({ id: 'alpha|zulu', score: 90 });
  });

  it('reconciles adjacent Suunto SleepIds to the canonical night shown by Suunto', () => {
    const source = { provider: 'SuuntoApp', providerUserId: 'suunto-user' };
    const context = buildDashboardSleepTrendContext([
      {
        id: 'part-1', source: { ...source, sourceSessionKey: 'sleep-id-1' }, sleepDate: '2026-09-28',
        startTimeMs: Date.parse('2026-09-27T18:57:00Z'), endTimeMs: Date.parse('2026-09-27T23:54:00Z'),
        timezoneOffsetSeconds: 3 * 3600,
        durationSeconds: 15_840, inBedDurationSeconds: 17_820, isNap: false,
        stageDurationsSeconds: { deep: 3_900, light: 10_200, rem: 1_740, awake: 1_620 },
        score: { value: 62 },
        vitals: { averageHeartRateBpm: 65, minimumHeartRateBpm: 61,
          averageHrvMs: 29, hrvSampleCount: 46, maxSpo2Percent: 98 },
        providerFields: { suunto: { SleepOnsetLatencyDuration: 360 } },
      },
      {
        id: 'part-2', source: { ...source, sourceSessionKey: 'sleep-id-2' }, sleepDate: '2026-09-28',
        startTimeMs: Date.parse('2026-09-28T00:01:00Z'), endTimeMs: Date.parse('2026-09-28T04:00:00Z'),
        timezoneOffsetSeconds: 3 * 3600,
        durationSeconds: 13_320, inBedDurationSeconds: 14_340, isNap: false,
        stageDurationsSeconds: { deep: 2_280, light: 7_380, rem: 3_660, awake: 540 },
        score: { value: 72 },
        vitals: { averageHeartRateBpm: 61, minimumHeartRateBpm: 57,
          averageHrvMs: 40, hrvSampleCount: 35, maxSpo2Percent: 99 },
        providerFields: { suunto: { SleepOnsetLatencyDuration: 480 } },
      },
    ] as any[]);

    expect(context.points).toHaveLength(1);
    expect(context.points[0]).toMatchObject({
      id: 'part-1|part-2',
      startTimeMs: Date.parse('2026-09-27T19:03:00Z'),
      endTimeMs: Date.parse('2026-09-28T04:00:00Z'),
      totalSeconds: 29_160,
      awakeSeconds: 3_060,
      score: 72,
      averageHeartRateBpm: 63,
      minimumHeartRateBpm: 57,
      hrvSampleCount: 81,
      maxSpo2Percent: 99,
    });
    expect(context.points[0].averageHrvMs).toBeCloseTo(33.753086, 5);
    expect(context.points[0].hrvObservations).toEqual([expect.objectContaining({
      timestampMs: Date.parse('2026-09-28T04:00:00Z'),
      calendarDate: '2026-09-28',
      value: context.points[0].averageHrvMs,
    })]);
    expect(context.latestPoint).toBe(context.points[0]);
    expect(context.latestPoint?.averageHrvMs).toBeCloseTo(33.753086, 5);
  });

  it('keeps non-adjacent Suunto sleeps separate even when their wake date matches', () => {
    const source = { provider: 'SuuntoApp', providerUserId: 'suunto-user' };
    const context = buildDashboardSleepTrendContext([
      { id: 'first', source: { ...source, sourceSessionKey: 'first' }, sleepDate: '2026-09-28',
        startTimeMs: 1_000, endTimeMs: 3_000, durationSeconds: 2, isNap: false },
      { id: 'second', source: { ...source, sourceSessionKey: 'second' }, sleepDate: '2026-09-28',
        startTimeMs: 3_000 + (31 * 60 * 1000), endTimeMs: 5_000 + (31 * 60 * 1000),
        durationSeconds: 2, isNap: false },
    ] as any[]);

    expect(context.points.map(point => point.id)).toEqual(['first', 'second']);
  });

  it('ignores invalid physiological fragments and bounds Suunto timezone offsets', () => {
    const startTimeMs = Date.UTC(2026, 0, 5, 22);
    const endTimeMs = Date.UTC(2026, 0, 6, 6);
    const context = buildDashboardSleepTrendContext([
      {
        id: 'invalid-fragment',
        startTimeMs,
        endTimeMs,
        sleepDate: '2026-01-06',
        durationSeconds: 4 * 3600,
        timezoneOffsetSeconds: Number.MAX_SAFE_INTEGER,
        vitals: { averageHeartRateBpm: -40, minimumHeartRateBpm: -30, averageHrvMs: -50 },
        providerFields: { suunto: { timestamp: '2026-01-06T00:00:00+02:00' } },
        source: { provider: 'SuuntoApp', providerUserId: 'suunto-user', sourceSessionKey: 'invalid-fragment' },
      },
      {
        id: 'valid-fragment',
        startTimeMs,
        endTimeMs,
        sleepDate: '2026-01-06',
        durationSeconds: 4 * 3600,
        timezoneOffsetSeconds: 2 * 60 * 60,
        vitals: { averageHeartRateBpm: 48, minimumHeartRateBpm: 44, averageHrvMs: 60 },
        source: { provider: 'SuuntoApp', providerUserId: 'suunto-user', sourceSessionKey: 'valid-fragment' },
      },
    ] as any[]);

    expect(context.points).toHaveLength(1);
    expect(context.points[0]).toMatchObject({
      sleepDate: '2026-01-06',
      averageHeartRateBpm: 48,
      minimumHeartRateBpm: 44,
      averageHrvMs: null,
    });
  });

  it('does not reconcile Suunto fragments without a provider-account identity', () => {
    const context = buildDashboardSleepTrendContext([
      { id: 'unknown-a', source: { provider: 'SuuntoApp', sourceSessionKey: 'a' }, sleepDate: '2026-09-28',
        startTimeMs: 1_000, endTimeMs: 3_000, durationSeconds: 2, isNap: false,
        vitals: { averageHrvMs: 29, hrvSampleCount: 46 } },
      { id: 'unknown-b', source: { provider: 'SuuntoApp', sourceSessionKey: 'b' }, sleepDate: '2026-09-28',
        startTimeMs: 4_000, endTimeMs: 6_000, durationSeconds: 2, isNap: false,
        vitals: { averageHrvMs: 40, hrvSampleCount: 35 } },
    ] as any[]);

    expect(context.points.map(point => point.id)).toEqual(['unknown-a', 'unknown-b']);
    expect(context.points.every(point => point.averageHrvMs === null)).toBe(true);
  });

  it('normalizes non-positive vitals when a night has only one stored fragment', () => {
    const context = buildDashboardSleepTrendContext([{
      id: 'invalid-vitals',
      startTimeMs: Date.UTC(2026, 0, 5, 22),
      endTimeMs: Date.UTC(2026, 0, 6, 6),
      sleepDate: '2026-01-06',
      durationSeconds: 8 * 3600,
      vitals: { averageHeartRateBpm: 0, minimumHeartRateBpm: -30, averageHrvMs: -50 },
      source: { provider: 'GarminAPI', sourceSessionKey: 'invalid-vitals' },
    }] as any[]);

    expect(context.points[0]).toMatchObject({
      averageHeartRateBpm: null,
      minimumHeartRateBpm: null,
      averageHrvMs: null,
    });
  });

  it('falls back from a missing sleep date and rejects timestamps outside the Date range', () => {
    const context = buildDashboardSleepTrendContext([{
      id: 'missing-date',
      startTimeMs: Date.UTC(2026, 0, 5, 22),
      endTimeMs: Date.UTC(2026, 0, 6, 6),
      sleepDate: '',
      durationSeconds: 8 * 3600,
      source: { provider: 'GarminAPI', sourceSessionKey: 'missing-date' },
    }, {
      id: 'invalid-time',
      startTimeMs: Number.MAX_SAFE_INTEGER - 1,
      endTimeMs: Number.MAX_SAFE_INTEGER,
      sleepDate: '',
      durationSeconds: 1,
      source: { provider: 'GarminAPI', sourceSessionKey: 'invalid-time' },
    }] as any[]);

    expect(context.points).toHaveLength(1);
    expect(context.points[0]).toMatchObject({ id: 'missing-date', sleepDate: '2026-01-06' });
  });

  it('rejects sleep records from unknown providers', () => {
    const context = buildDashboardSleepTrendContext([{
      id: 'unknown-provider',
      startTimeMs: Date.UTC(2026, 0, 5, 22),
      endTimeMs: Date.UTC(2026, 0, 6, 6),
      sleepDate: '2026-01-06',
      durationSeconds: 8 * 3600,
      source: { provider: 'UnknownProvider', sourceSessionKey: 'unknown-provider' },
    }] as any[]);

    expect(context.points).toEqual([]);
  });

  it('fills missing sleep dates inside the selected sleep window with empty points', () => {
    const endMs = Date.UTC(2026, 0, 5, 12);
    const context = buildDashboardSleepTrendContext([
      {
        id: 'suunto-sleep-jan-3',
        startTimeMs: Date.UTC(2026, 0, 2, 22),
        endTimeMs: Date.UTC(2026, 0, 3, 6),
        sleepDate: '2026-01-03',
        durationSeconds: 8 * 3600,
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-source-jan-3' },
      },
      {
        id: 'suunto-sleep-jan-5',
        startTimeMs: Date.UTC(2026, 0, 4, 22),
        endTimeMs: Date.UTC(2026, 0, 5, 6),
        sleepDate: '2026-01-05',
        durationSeconds: 8 * 3600,
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-source-jan-5' },
      },
    ] as any[], {
      sleepWindow: {
        range: '14d',
        startMs: endMs - (14 * 24 * 60 * 60 * 1000),
        endMs,
      },
    });

    const missingDate = context.points.find(point => point.sleepDate === '2026-01-04');

    expect(context.points).toHaveLength(14);
    expect(missingDate).toMatchObject({
      id: 'sleep-placeholder:2026-01-04',
      provider: null,
      providerLabel: '',
      categoryLabel: expectedSleepDateLabel('2026-01-04'),
      totalSeconds: 0,
      averageHrvMs: null,
      isPlaceholder: true,
    });
    expect(context.points.filter(point => !point.isPlaceholder).map(point => point.id)).toEqual([
      'suunto-sleep-jan-3',
      'suunto-sleep-jan-5',
    ]);
    expect(context.latestPoint?.id).toBe('suunto-sleep-jan-5');
    expect(context.hasRealPoints).toBe(true);
  });

  it('does not synthesize an empty point for the current day when sleep is missing', () => {
    const nowMs = Date.UTC(2026, 0, 5, 12);
    const context = buildDashboardSleepTrendContext([
      {
        id: 'suunto-sleep-jan-4',
        startTimeMs: Date.UTC(2026, 0, 3, 22),
        endTimeMs: Date.UTC(2026, 0, 4, 6),
        sleepDate: '2026-01-04',
        durationSeconds: 8 * 3600,
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-source-jan-4' },
      },
    ] as any[], {
      sleepWindow: {
        range: '14d',
        startMs: nowMs - (14 * 24 * 60 * 60 * 1000),
        endMs: nowMs,
      },
      nowMs,
    });

    expect(context.points.some(point => point.sleepDate === '2026-01-05')).toBe(false);
    expect(context.points).toHaveLength(13);
    expect(context.latestPoint?.id).toBe('suunto-sleep-jan-4');
  });

  it('formats durations for chart headers and tooltips', () => {
    expect(formatSleepDuration(0)).toBe('--');
    expect(formatSleepDuration(42 * 60)).toBe('42m');
    expect(formatSleepDuration((7 * 3600) + (5 * 60))).toBe('7h 05m');
    expect(formatSleepDuration((1 * 3600) + (59 * 60) + 31)).toBe('2h 00m');
  });
});
