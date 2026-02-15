import { describe, expect, it } from 'vitest';
import { reconcileEventDetailsLiveUpdate } from './event-live-reconcile';

const createActivity = (
  id: string,
  streams: any[] = [],
  streamGetter: 'getStreams' | 'getAllStreams' = 'getStreams',
): any => {
  let currentStreams = [...streams];
  const getter = () => currentStreams;
  return {
    getID: () => id,
    ...(streamGetter === 'getStreams' ? { getStreams: getter } : { getAllStreams: getter }),
    clearStreams: () => {
      currentStreams = [];
    },
    addStreams: (nextStreams: any[]) => {
      currentStreams = [...nextStreams];
    },
  };
};

const createEvent = (activities: any[]): any => ({
  getActivities: () => activities,
});

describe('event-live-reconcile', () => {
  it('preserves selected activity IDs and existing streams when activity IDs match', () => {
    const currentActivity = createActivity('a1', [{ type: 'Speed', values: [1, 2, 3] }]);
    const incomingActivity = createActivity('a1');
    const currentEvent = createEvent([currentActivity]);
    const incomingEvent = createEvent([incomingActivity]);

    const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

    expect(result.needsFullReload).toBe(false);
    expect(result.selectedActivityIDs).toEqual(['a1']);
    expect(incomingActivity.getStreams()).toEqual([{ type: 'Speed', values: [1, 2, 3] }]);
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

  it('preserves streams when source activity exposes getAllStreams', () => {
    const currentActivity = createActivity('a1', [{ type: 'LatitudeDegrees', values: [1] }], 'getAllStreams');
    const incomingActivity = createActivity('a1');
    const currentEvent = createEvent([currentActivity]);
    const incomingEvent = createEvent([incomingActivity]);

    const result = reconcileEventDetailsLiveUpdate(currentEvent, incomingEvent, ['a1']);

    expect(result.needsFullReload).toBe(false);
    expect(incomingActivity.getStreams()).toEqual([{ type: 'LatitudeDegrees', values: [1] }]);
  });
});
