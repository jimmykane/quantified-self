import { describe, expect, it } from 'vitest';
import { buildActivityEditWritePayload, buildActivityWriteData, buildEventWriteData } from './activity-edit.persistence';

describe('activity-edit.persistence', () => {
  it('buildActivityWriteData strips streams and adds identity metadata', () => {
    const event = {
      getID: () => 'event-1',
      startDate: new Date('2026-02-14T00:00:00.000Z'),
    } as any;

    const activity = {
      toJSON: () => ({
        creator: { name: 'Device A' },
        streams: [{ type: 'Pace', values: [1, 2, 3] }],
        stats: {},
      }),
    } as any;

    const result = buildActivityWriteData('user-1', event, activity);

    expect(result.streams).toBeUndefined();
    expect(result.eventID).toBe('event-1');
    expect(result.userID).toBe('user-1');
    expect(result.eventStartDate).toEqual(event.startDate);
    expect(result.creator).toEqual({ name: 'Device A' });
  });

  it('buildEventWriteData preserves original file metadata', () => {
    const originalFiles = [{ path: 'users/user-1/events/event-1/original.fit', startDate: new Date('2026-02-14T00:00:00.000Z') }];
    const originalFile = originalFiles[0];

    const event = {
      toJSON: () => ({ name: 'Event Name' }),
      originalFiles,
      originalFile,
    } as any;

    const result = buildEventWriteData(event);

    expect(result.name).toBe('Event Name');
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
      toJSON: () => ({ creator: { name: 'Device A' }, streams: [{ type: 'Pace', values: [1] }] }),
    } as any;

    const result = buildActivityEditWritePayload('user-1', event, activity);

    expect(result.activityData.streams).toBeUndefined();
    expect(result.activityData.userID).toBe('user-1');
    expect(result.eventData.title).toBe('Event Title');
    expect(result.eventData.originalFile).toEqual(event.originalFile);
  });
});
