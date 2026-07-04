import { ActivityTypes, DataDuration } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { POWER_CURVE_STAT_TYPE } from '@shared/power-curve';
import { buildDashboardPowerCurveContext } from './dashboard-power-curve.helper';

function makePowerCurveEvent(options: {
  id: string;
  startDate: string;
  activityTypes?: ActivityTypes[];
  points?: unknown;
  durationSeconds?: number;
  durationStatSeconds?: number;
  endDate?: string;
  omitGetDuration?: boolean;
}): any {
  const event: any = {
    startDate: new Date(options.startDate),
    endDate: options.endDate ? new Date(options.endDate) : undefined,
    getID: () => options.id,
    getActivityTypesAsArray: () => options.activityTypes || [ActivityTypes.Cycling],
    getStat: (type: string) => {
      if (type === DataDuration.type && options.durationStatSeconds !== undefined) {
        return {
          getValue: () => options.durationStatSeconds,
        };
      }
      if (type !== POWER_CURVE_STAT_TYPE || options.points === undefined) {
        return null;
      }
      return {
        getValue: () => options.points,
      };
    },
  };
  if (!options.omitGetDuration) {
    event.getDuration = () => (
      options.durationSeconds === undefined
        ? null
        : { getValue: () => options.durationSeconds }
    );
  }
  return event;
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

  it('drops stored power-curve points that are longer than the event duration', () => {
    const latestShortRide = makePowerCurveEvent({
      id: 'latest-short-ride',
      startDate: '2026-07-02T14:32:41.000Z',
      durationSeconds: 1195.27,
      points: [
        { duration: 60, power: 220 },
        { duration: 300, power: 180 },
        { duration: 1200, power: 109 },
      ],
    });

    const context = buildDashboardPowerCurveContext([latestShortRide]);

    expect(context.matchedEventCount).toBe(1);
    expect(context.latestEventId).toBe('latest-short-ride');
    expect(context.summaryPoints).toEqual([
      { duration: 60, power: 220 },
      { duration: 300, power: 180 },
    ]);
    expect(context.series[0].points.map(point => point.duration)).toEqual([60, 300]);
  });

  it('uses DataDuration stat fallback when filtering power-curve points', () => {
    const latestShortRide = makePowerCurveEvent({
      id: 'duration-stat-short-ride',
      startDate: '2026-07-02T14:32:41.000Z',
      omitGetDuration: true,
      durationStatSeconds: 1195.27,
      points: [
        { duration: 300, power: 180 },
        { duration: 1200, power: 109 },
      ],
    });

    const context = buildDashboardPowerCurveContext([latestShortRide]);

    expect(context.series[0].points.map(point => point.duration)).toEqual([300]);
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
