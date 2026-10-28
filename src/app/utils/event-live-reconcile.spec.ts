import { describe, expect, it } from 'vitest';
import { ActivityTypes, DataLatitudeDegrees, DataLongitudeDegrees, DataSpeed, EventImporterJSON, Stream } from '@sports-alliance/sports-lib';
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
  it('keeps GPS and chart streams across repeated metadata updates that reuse live activities', () => {
    const startDate = new Date('2026-01-01T10:00:00Z');
    const endDate = new Date('2026-01-01T10:00:02Z');
    const activityJSON = {
      startDate: +startDate, endDate: +endDate, type: ActivityTypes.Running,
      name: '', powerMeter: false, trainer: false, creator: { name: 'Watch', devices: [] },
      stats: {}, laps: [], streams: [], intensityZones: [], events: [],
    };
    const hydratedActivity = EventImporterJSON.getActivityFromJSON(activityJSON).setID('a1');
    const streams = [
      new Stream(DataLatitudeDegrees.type, [60, 60.001, 60.002]),
      new Stream(DataLongitudeDegrees.type, [24, 24.001, 24.002]),
      new Stream(DataSpeed.type, [2, 3, 4]),
    ];
    hydratedActivity.addStreams(streams);
    const liveActivity = EventImporterJSON.getActivityFromJSON(activityJSON).setID('a1');
    const initialLiveEvent = createEvent([liveActivity]);
    let currentEvent = reconcileEventDetailsLiveUpdate(createEvent([hydratedActivity]), initialLiveEvent, ['a1']).reconciledEvent;

    for (const privacy of ['public', 'private', 'public']) {
      const incomingEvent = { ...createEvent([liveActivity]), privacy };
      const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

      expect(result.needsFullReload).toBe(false);
      expect(result.selectedActivityIDs).toEqual(['a1']);
      expect(liveActivity.hasPositionData()).toBe(true);
      expect(liveActivity.getAllStreams()).toEqual(streams);
      expect(liveActivity.getStreamData(DataSpeed.type)).toEqual([2, 3, 4]);
      currentEvent = result.reconciledEvent;
    }
  });

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

  it.each(['path', 'bucket', 'generation', 'reparse', 'source-sport', 'source-window'])(
    'reloads changed source data even when activity IDs stay stable: %s', change => {
      const currentActivity = createActivity('a1', [{ type: 'Speed', values: [1, 2, 3] }]);
      const incomingActivity = createActivity('a1');
      const sourceIdentity = { version: 1, activityId: 'a1', startMs: 0, endMs: 3000, importedType: 'Running' };
      currentActivity.sourceIdentity = sourceIdentity;
      incomingActivity.sourceIdentity = { ...sourceIdentity,
        ...(change === 'source-sport' ? { importedType: 'Cycling' } : {}),
        ...(change === 'source-window' ? { endMs: 4000 } : {}),
      };
      const originalFile = { path: 'original.fit', bucket: 'bucket', generation: '1' };
      const currentEvent = { ...createEvent([currentActivity]), originalFile, benchmarkSourceRevision: 1 };
      const incomingEvent = { ...createEvent([incomingActivity]),
        originalFiles: [{ ...originalFile, ...(['path', 'bucket', 'generation'].includes(change) ? { [change]: 'updated' } : {}) }],
        benchmarkSourceRevision: change === 'reparse' ? 2 : 1,
      };

      const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

      expect(result.needsFullReload).toBe(true);
      expect(result.selectedActivityIDs).toEqual(['a1']);
      expect(incomingActivity.getAllStreams()).toEqual([]);
      expect(currentActivity.getAllStreams()).toEqual([{ type: 'Speed', values: [1, 2, 3] }]);
    },
  );

  it('reuses streams for owner edits and equivalent canonical/legacy file references', () => {
    const currentActivity = createActivity('a1', [{ type: 'Speed', values: [1, 2, 3] }]);
    const incomingActivity = createActivity('a1');
    const sourceIdentity = { version: 1, activityId: 'a1', startMs: 0, endMs: 3000, importedType: 'Running' };
    currentActivity.sourceIdentity = sourceIdentity;
    incomingActivity.sourceIdentity = { ...sourceIdentity };
    incomingActivity.type = 'Walking';
    const originalFile = { path: 'original.fit', bucket: 'bucket', generation: '1' };
    const currentEvent = { ...createEvent([currentActivity]), originalFile };
    const incomingEvent = { ...createEvent([incomingActivity]), originalFiles: [{ ...originalFile,
      originalFilename: 'renamed.fit', startDate: new Date(0) }], privacy: 'private', benchmarkSourceRevision: 0 };

    const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

    expect(result.needsFullReload).toBe(false);
    expect(incomingActivity.getAllStreams()).toEqual(currentActivity.getAllStreams());
  });

  it('refreshes a legacy activity when its source association is first recorded', () => {
    const incoming = createActivity('a1');
    incoming.sourceIdentity = { version: 1, activityId: 'a1', startMs: 0, endMs: 3000, importedType: 'Running' };
    expect(reconcileEventDetailsLiveUpdate(createEvent([createActivity('a1')]), createEvent([incoming]), ['a1'])
      .needsFullReload).toBe(true);
  });

  it('keeps each leg’s streams when the same multisport activities arrive in another order', () => {
    const first = createActivity('a1', [{ type: 'Speed', values: [1] }]);
    const second = createActivity('a2', [{ type: 'Speed', values: [2] }]);
    const incoming = [createActivity('a2'), createActivity('a1')];
    const result = reconcileEventDetailsLiveUpdate(createEvent([first, second]), createEvent(incoming), ['a2']);
    expect(result.needsFullReload).toBe(false);
    expect(result.selectedActivityIDs).toEqual(['a2']);
    expect(incoming.map(activity => activity.getAllStreams())).toEqual([second.getAllStreams(), first.getAllStreams()]);
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
