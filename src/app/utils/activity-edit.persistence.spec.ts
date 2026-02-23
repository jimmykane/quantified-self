import { describe, expect, it } from 'vitest';
import { buildActivityEditWritePayload, buildActivityWriteData, buildEventWriteData } from './activity-edit.persistence';

function hasStreamsKey(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasStreamsKey);
  }

  if (typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'streams')) {
    return true;
  }

  return Object.values(record).some(hasStreamsKey);
}

describe('activity-edit.persistence', () => {
  it('buildActivityWriteData strips streams recursively and adds identity metadata', () => {
    const event = {
      getID: () => 'event-1',
      startDate: new Date('2026-02-14T00:00:00.000Z'),
    } as any;

    const activity = {
      toJSON: () => ({
        creator: { name: 'Device A' },
        streams: [{ type: 'Pace', values: [1, 2, 3] }],
        laps: [{ split: 1, streams: [{ type: 'HR', values: [150, 151] }] }],
        stats: {},
      }),
    } as any;

    const result = buildActivityWriteData('user-1', event, activity);

    expect(hasStreamsKey(result)).toBe(false);
    expect(result.eventID).toBe('event-1');
    expect(result.userID).toBe('user-1');
    expect(result.eventStartDate).toEqual(event.startDate);
    expect(result.creator).toEqual({ name: 'Device A' });
  });

  it('buildEventWriteData strips streams, removes top-level activities, and preserves original file metadata', () => {
    const originalFiles = [{ path: 'users/user-1/events/event-1/original.fit', startDate: new Date('2026-02-14T00:00:00.000Z') }];
    const originalFile = originalFiles[0];

    const event = {
      toJSON: () => ({
        name: 'Event Name',
        activities: [
          {
            id: 'a1',
            streams: [{ type: 'Power', values: [100, 200] }],
          },
        ],
        details: {
          streams: [{ type: 'Power', values: [100, 200] }],
        },
      }),
      originalFiles,
      originalFile,
    } as any;

    const result = buildEventWriteData(event);

    expect(result.name).toBe('Event Name');
    expect(result.activities).toBeUndefined();
    expect(hasStreamsKey(result)).toBe(false);
    expect(result.originalFiles).toBe(originalFiles);
    expect(result.originalFile).toBe(originalFile);
  });

  it('buildActivityEditWritePayload composes activity and event write payloads', () => {
    const event = {
      getID: () => 'event-1',
      startDate: new Date('2026-02-14T00:00:00.000Z'),
      toJSON: () => ({ title: 'Event Title' }),
      originalFile: { path: 'users/user-1/events/event-1/original.fit', startDate: new Date('2026-02-14T00:00:00.000Z') },
    } as any;

    const activity = {
      toJSON: () => ({
        creator: { name: 'Device A' },
        streams: [{ type: 'Pace', values: [1] }],
        nested: { streams: [{ type: 'Power', values: [200] }] },
      }),
    } as any;

    const result = buildActivityEditWritePayload('user-1', event, activity);

    expect(hasStreamsKey(result.activityData)).toBe(false);
    expect(result.activityData.userID).toBe('user-1');
    expect(result.eventData.title).toBe('Event Title');
    expect(result.eventData.originalFile).toEqual(event.originalFile);
  });
});
