import { ActivityInterface, DataJumpEvent } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { hasVisibleEventJumps } from './event-jump-type.helper';

function createActivity(events: unknown[]): ActivityInterface {
  return {
    getAllEvents: () => events,
  } as unknown as ActivityInterface;
}

describe('event-jump-type.helper', () => {
  it('returns false when there are no activities', () => {
    expect(hasVisibleEventJumps([])).toBe(false);
    expect(hasVisibleEventJumps(null)).toBe(false);
    expect(hasVisibleEventJumps(undefined)).toBe(false);
  });

  it('returns true when a typed DataJumpEvent exists', () => {
    const jumpEvent = new DataJumpEvent(15, {
      distance: 3.5,
      score: 7.2,
    });

    expect(hasVisibleEventJumps([createActivity([jumpEvent])])).toBe(true);
  });

  it('returns true when a plain-object jump event has jumpData object', () => {
    expect(hasVisibleEventJumps([
      createActivity([
        { timestamp: 20, jumpData: { distance: 3.5, score: 7.2 } },
      ]),
    ])).toBe(true);
  });

  it('returns false when jumpData is missing or invalid', () => {
    expect(hasVisibleEventJumps([
      createActivity([
        { timestamp: 20 },
        { timestamp: 21, jumpData: null },
        { timestamp: 22, jumpData: '' },
      ]),
    ])).toBe(false);
  });
});
