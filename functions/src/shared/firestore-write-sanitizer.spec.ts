import { describe, expect, it } from 'vitest';
import {
  sanitizeActivityFirestoreWritePayload,
  sanitizeEventFirestoreWritePayload,
  stripStreamsRecursivelyInPlace,
} from './firestore-write-sanitizer';

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

describe('firestore-write-sanitizer', () => {
  it('stripStreamsRecursivelyInPlace removes streams keys from nested payloads', () => {
    const payload: Record<string, unknown> = {
      streams: [{ type: 'Power', values: [100, 200] }],
      laps: [{ streams: [{ type: 'Pace', values: [1, 2] }] }],
      nested: {
        values: [
          { streams: [{ type: 'HeartRate', values: [150] }] },
          { data: { streams: [] } },
        ],
      },
    };

    stripStreamsRecursivelyInPlace(payload);

    expect(hasStreamsKey(payload)).toBe(false);
  });

  it('sanitizeActivityFirestoreWritePayload strips streams recursively', () => {
    const payload = sanitizeActivityFirestoreWritePayload({
      name: 'Activity',
      streams: [{ type: 'Power' }],
      nested: {
        streams: [{ type: 'Pace' }],
      },
    });

    expect(payload.name).toBe('Activity');
    expect(hasStreamsKey(payload)).toBe(false);
  });

  it('sanitizeEventFirestoreWritePayload strips streams and removes top-level activities', () => {
    const payload = sanitizeEventFirestoreWritePayload({
      name: 'Event',
      activities: [{ id: 'a1' }],
      details: {
        streams: [{ type: 'Power' }],
      },
      nested: {
        activities: [{ id: 'still-allowed-nested' }],
      },
    });

    expect(payload.name).toBe('Event');
    expect(payload.activities).toBeUndefined();
    expect((payload.nested as Record<string, unknown>).activities).toEqual([{ id: 'still-allowed-nested' }]);
    expect(hasStreamsKey(payload)).toBe(false);
  });
});
