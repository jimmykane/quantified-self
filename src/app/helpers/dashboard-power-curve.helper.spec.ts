import { ActivityTypes } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { POWER_CURVE_STAT_TYPE } from '@shared/power-curve';
import { buildDashboardPowerCurveContext } from './dashboard-power-curve.helper';

function makePowerCurveEvent(options: {
  id: string;
  startDate: string;
  activityTypes?: ActivityTypes[];
  points?: unknown;
}): any {
  return {
    startDate: new Date(options.startDate),
    getID: () => options.id,
    getActivityTypesAsArray: () => options.activityTypes || [ActivityTypes.Cycling],
    getStat: (type: string) => {
      if (type !== POWER_CURVE_STAT_TYPE || options.points === undefined) {
        return null;
      }
      return {
        getValue: () => options.points,
      };
    },
  };
}

describe('dashboard-power-curve.helper', () => {
  it('builds best-in-range and latest-ride series from normalized event power curves', () => {
    const olderBest = makePowerCurveEvent({
      id: 'older-best',
      startDate: '2026-01-01T10:00:00.000Z',
      points: [
        { duration: 60, power: 420, wattsPerKg: 5.3 },
        { duration: 300, power: 360, wattsPerKg: 4.6 },
      ],
    });
    const latestRide = makePowerCurveEvent({
      id: 'latest',
      startDate: '2026-01-03T10:00:00.000Z',
      points: [
        { duration: 60, power: 400, wattsPerKg: 5.1 },
        { duration: 300, power: 330, wattsPerKg: 4.2 },
      ],
    });

    const context = buildDashboardPowerCurveContext([olderBest, latestRide]);

    expect(context.matchedEventCount).toBe(2);
    expect(context.sourceEventCount).toBe(2);
    expect(context.latestEventId).toBe('latest');
    expect(context.summaryPoints).toEqual([
      { duration: 60, power: 420, wattsPerKg: 5.3 },
      { duration: 300, power: 360, wattsPerKg: 4.6 },
    ]);
    expect(context.series.map(series => series.seriesKey)).toEqual(['best', 'latest']);
    expect(context.series[0].label).toBe('Best in range');
    expect(context.series[1].label).toBe('Latest ride');
  });

  it('uses one latest-and-best series when the latest ride is also the envelope', () => {
    const latestBest = makePowerCurveEvent({
      id: 'latest-best',
      startDate: '2026-01-03T10:00:00.000Z',
      points: [
        { duration: 60, power: 430 },
        { duration: 300, power: 365 },
      ],
    });

    const context = buildDashboardPowerCurveContext([latestBest]);

    expect(context.series).toHaveLength(1);
    expect(context.series[0]).toMatchObject({
      seriesKey: 'latestAndBest',
      label: 'Latest and best',
      eventId: 'latest-best',
    });
  });

  it('returns an empty context when no events have usable PowerCurve stats', () => {
    const context = buildDashboardPowerCurveContext([
      makePowerCurveEvent({
        id: 'invalid',
        startDate: '2026-01-01T10:00:00.000Z',
        points: [{ duration: 'bad', power: null }],
      }),
    ]);

    expect(context).toEqual({
      matchedEventCount: 0,
      sourceEventCount: 1,
      series: [],
      summaryPoints: [],
      latestEventId: null,
      latestEventStartMs: null,
    });
  });
});
