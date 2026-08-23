import { describe, expect, it } from 'vitest';
import { reconcileEventDetailsLiveUpdate } from './event-live-reconcile';

const createActivity = (
  id: string,
  streams: any[] = [],
  sourceRecords: any = { gases: [], tankSummaries: [], tankUpdates: [] },
): any => {
  let currentStreams = [...streams];
  let currentSourceRecords = sourceRecords;
  return {
    getID: () => id,
    getAllStreams: () => currentStreams,
    getDiveSourceRecords: () => currentSourceRecords,
    clearStreams: () => {
      currentStreams = [];
    },
    addStreams: (nextStreams: any[]) => {
      currentStreams = [...nextStreams];
    },
    setDiveSourceRecords: (nextSourceRecords: any) => {
      currentSourceRecords = nextSourceRecords;
    },
  };
};

const createEvent = (activities: any[]): any => ({
  getActivities: () => activities,
});

describe('event-live-reconcile', () => {
  it('preserves selected activity IDs, streams, and legacy source-hydrated records when activity IDs match', () => {
    const sourceRecords = {
      gases: [{ oxygenContent: 32, heliumContent: 0 }],
      tankSummaries: [{ startPressure: 200, endPressure: 75, volumeUsed: 1250 }],
      tankUpdates: [{ pressure: 200 }],
    };
    const currentActivity = createActivity('a1', [{ type: 'Speed', values: [1, 2, 3] }], sourceRecords);
    const incomingActivity = createActivity('a1');
    const currentEvent = createEvent([currentActivity]);
    const incomingEvent = createEvent([incomingActivity]);

    const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

    expect(result.needsFullReload).toBe(false);
    expect(result.selectedActivityIDs).toEqual(['a1']);
    expect(incomingActivity.getAllStreams()).toEqual([{ type: 'Speed', values: [1, 2, 3] }]);
    expect(incomingActivity.getDiveSourceRecords()).toEqual(sourceRecords);
  });

  it('flags full reload when activity IDs changed', () => {
    const currentEvent = createEvent([createActivity('a1')]);
    const incomingEvent = createEvent([createActivity('a2')]);

    const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

    expect(result.needsFullReload).toBe(true);
    expect(result.selectedActivityIDs).toEqual([]);
  });

  it('returns incoming event directly when there is no current event', () => {
    const incomingEvent = createEvent([createActivity('a1')]);

    const result = reconcileEventDetailsLiveUpdate(null, incomingEvent, ['a1']);

    expect(result.reconciledEvent).toBe(incomingEvent);
    expect(result.needsFullReload).toBe(false);
    expect(result.selectedActivityIDs).toEqual(['a1']);
  });

  it('keeps persisted source records from a matching live activity', () => {
    const sourceHydratedRecords = {
      gases: [{ oxygenContent: 32, status: 'enabled' }],
      tankSummaries: [],
      tankUpdates: [],
    };
    const persistedRecords = {
      gases: [{ oxygenContent: 50, status: 'enabled' }],
      tankSummaries: [{ startPressure: 200, endPressure: 75, volumeUsed: 1250 }],
      tankUpdates: [{ pressure: 198.4 }],
    };
    const currentActivity = createActivity('a1', [{ type: 'LatitudeDegrees', values: [1] }], sourceHydratedRecords);
    const incomingActivity = createActivity('a1', [], persistedRecords);
    const currentEvent = createEvent([currentActivity]);
    const incomingEvent = createEvent([incomingActivity]);

    const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

    expect(result.needsFullReload).toBe(false);
    expect(incomingActivity.getAllStreams()).toEqual([{ type: 'LatitudeDegrees', values: [1] }]);
    expect(incomingActivity.getDiveSourceRecords()).toEqual(persistedRecords);
  });
});
