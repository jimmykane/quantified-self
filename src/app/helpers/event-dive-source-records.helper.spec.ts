import {
  ActivityInterface,
  ActivityTypes,
  DiveSourceRecords,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  getEventDiveSourceRecordActivities,
  hasActivityDiveSourceRecords,
  hasEventDiveSourceRecords,
} from './event-dive-source-records.helper';

function createActivity(
  id: string,
  type: ActivityTypes,
  records: DiveSourceRecords,
): ActivityInterface {
  return {
    type,
    getID: () => id,
    getDiveSourceRecords: () => records,
  } as ActivityInterface;
}

describe('event-dive-source-records.helper', () => {
  it('keeps only Diving-group activities with parser-provided source records', () => {
    const diveRecords: DiveSourceRecords = {
      gases: [{ oxygenContent: 32, heliumContent: 15, status: 'enabled', mode: 'open_circuit' }],
      tankSummaries: [{ startPressure: 200, endPressure: 75, volumeUsed: 1250 }],
      tankUpdates: [{ pressure: 200 }],
    };
    const activities = [
      createActivity('dive-1', ActivityTypes.ScubaDiving, diveRecords),
      createActivity('run-1', ActivityTypes.Running, diveRecords),
      createActivity('dive-2', ActivityTypes.FreeDiving, {
        gases: [],
        tankSummaries: [],
        tankUpdates: [],
      }),
    ];

    expect(hasActivityDiveSourceRecords(activities[0])).toBe(true);
    expect(hasActivityDiveSourceRecords(activities[2])).toBe(false);
    expect(hasEventDiveSourceRecords(activities)).toBe(true);
    expect(getEventDiveSourceRecordActivities(activities)).toEqual([
      { activity: activities[0], records: diveRecords },
    ]);
  });

  it('does not surface an empty or non-Diving source record set', () => {
    const records: DiveSourceRecords = {
      gases: [{ oxygenContent: 100 }],
      tankSummaries: [],
      tankUpdates: [],
    };

    expect(hasEventDiveSourceRecords([
      createActivity('run-1', ActivityTypes.Running, records),
    ])).toBe(false);
    expect(getEventDiveSourceRecordActivities([])).toEqual([]);
  });
});
