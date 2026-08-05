import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  DataAscent,
  DataDescent,
  DataDistance,
  DataDuration,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import { buildActivityCalendarPeriodSummary } from './activity-calendar.helper';
import { buildActivityCalendarFamilyVolumeRows, buildActivityCalendarVolumeStats } from './activity-calendar-volume.helper';

describe('activity-calendar-volume helper', () => {
  it('builds duration bars with available distance and elevation statistics', () => {
    const rows = buildActivityCalendarFamilyVolumeRows(buildActivityCalendarPeriodSummary([
      createEvent('run', ActivityTypes.Running, {
        [DataDuration.type]: 3600,
        [DataDistance.type]: 10_000,
        [DataAscent.type]: 450,
        [DataDescent.type]: 420,
      }),
      createEvent('ride', ActivityTypes.Cycling, {
        [DataDuration.type]: 1800,
        [DataDistance.type]: 5000,
      }),
    ]), null, 'en-US');

    expect(rows.map(row => ({ label: row.label, barPercent: row.barPercent }))).toEqual([
      { label: 'Running', barPercent: 100 },
      { label: 'Cycling', barPercent: 50 },
    ]);
    expect(rows[0].stats.map(stat => stat.ariaLabel)).toEqual([
      'Duration 1h',
      'Distance 10.00 Km',
      'Ascent 450 m',
      'Descent 420 m',
    ]);
    expect(rows[1].stats.map(stat => stat.ariaLabel)).toEqual([
      'Duration 30m',
      'Distance 5.00 Km',
    ]);
  });

  it('retains downhill descent while omitting excluded ascent', () => {
    const rows = buildActivityCalendarFamilyVolumeRows(buildActivityCalendarPeriodSummary([
      createEvent('downhill', ActivityTypes.DownhillCycling, {
        [DataDuration.type]: 3600,
        [DataAscent.type]: 900,
        [DataDescent.type]: 1200,
      }),
    ]), null, 'en-US');

    expect(rows[0].stats.map(stat => stat.ariaLabel)).toEqual([
      'Duration 1h',
      'Descent 1,200 m',
    ]);
  });

  it('can omit duplicated duration from an individual activity metric strip', () => {
    const summary = buildActivityCalendarPeriodSummary([
      createEvent('run', ActivityTypes.Running, {
        [DataDuration.type]: 3600,
        [DataDistance.type]: 10_000,
        [DataAscent.type]: 450,
        [DataDescent.type]: 420,
      }),
    ]);

    const stats = buildActivityCalendarVolumeStats(summary.families[0].metrics, null, 'en-US', {
      includeDuration: false,
    });

    expect(stats.map(stat => stat.ariaLabel)).toEqual([
      'Distance 10.00 Km',
      'Ascent 450 m',
      'Descent 420 m',
    ]);
  });
});

function createEvent(
  id: string,
  activityType: ActivityTypes,
  stats: Record<string, number | null>,
): EventInterface {
  return {
    getID: () => id,
    getActivityTypesAsArray: () => [activityType],
    getActivityTypesAsString: () => activityType,
    getStat: (type: string) => {
      const value = stats[type];
      return value === null || value === undefined ? null : { getValue: () => value };
    },
  } as unknown as EventInterface;
}
