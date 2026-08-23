import { describe, expect, it } from 'vitest';
import type { AppEventInterface } from '../../../shared/app-event.interface';
import { sanitizeActivityFirestoreWritePayload } from '../../../shared/firestore-write-sanitizer';
import { EventWriter } from './event-writer';
import type { FirestoreAdapter } from './event-writer';

function containsKeyRecursively(value: unknown, targetKey: string): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsKeyRecursively(item, targetKey));
  }

  if (typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, targetKey)
    || Object.values(record).some((item) => containsKeyRecursively(item, targetKey));
}

describe('dive source record persistence', () => {
  const diveSourceRecords = {
    gases: [{ oxygenContent: 32, heliumContent: 15, status: 'enabled' }],
    tankSummaries: [{
      timestamp: 1787211300000,
      sensor: 3578158576,
      startPressure: 199.46,
      endPressure: 74.67,
      volumeUsed: 1396.01,
    }],
    tankUpdates: [{ timestamp: 1787211360000, sensor: 3578158576, pressure: 198.4 }],
  };

  it('keeps native dive gas and tank records when stripping streams', () => {
    const payload = sanitizeActivityFirestoreWritePayload({
      streams: [{ type: 'Depth', data: [0, 12] }],
      diveSourceRecords,
    });

    expect(payload.diveSourceRecords).toEqual(diveSourceRecords);
    expect(containsKeyRecursively(payload, 'streams')).toBe(false);
  });

  it('writes native dive gas and tank records to the activity document', async () => {
    const writes: Array<{ path: string[]; data: unknown }> = [];
    const adapter: FirestoreAdapter = {
      setDoc: async (path, data) => {
        writes.push({ path, data });
      },
      createBlob: (data) => data,
      generateID: () => 'generated-id',
    };
    const activity = {
      getID: () => 'activity-1',
      setID: () => undefined,
      toJSON: () => ({
        id: 'activity-1',
        streams: [{ type: 'Depth', data: [0, 12] }],
        diveSourceRecords,
      }),
    };
    const event = {
      getID: () => 'event-1',
      setID: () => undefined,
      getActivities: () => [activity],
      toJSON: () => ({ id: 'event-1', activities: [] }),
      startDate: new Date('2026-08-20T00:00:00.000Z'),
    };

    await new EventWriter(adapter).writeAllEventData('user-1', event as unknown as AppEventInterface);

    const activityWrite = writes.find(({ path }) =>
      path[0] === 'users' && path[1] === 'user-1' && path[2] === 'activities'
    );
    expect(activityWrite?.data).toEqual(expect.objectContaining({ diveSourceRecords }));
    expect(containsKeyRecursively(activityWrite?.data, 'streams')).toBe(false);
  });
});
