import { describe, expect, it } from 'vitest';
import { buildDashboardSleepTrendContext, formatSleepDuration } from './dashboard-sleep-chart.helper';

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
        maxSpo2Percent: 98,
      },
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

  it('formats durations for chart headers and tooltips', () => {
    expect(formatSleepDuration(0)).toBe('--');
    expect(formatSleepDuration(42 * 60)).toBe('42m');
    expect(formatSleepDuration((7 * 3600) + (5 * 60))).toBe('7h 05m');
  });
});
