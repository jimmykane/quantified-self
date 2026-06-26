import { describe, expect, it } from 'vitest';
import { buildDashboardSleepTrendContext, formatSleepDuration } from './dashboard-sleep-chart.helper';

function expectedSleepDateLabel(sleepDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${sleepDate}T00:00:00.000Z`));
}

describe('dashboard-sleep-chart.helper', () => {
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
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-previous-overnight-source' },
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
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-nap-source' },
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
        source: { provider: 'SuuntoApp', sourceSessionKey: 'suunto-next-overnight-source' },
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
