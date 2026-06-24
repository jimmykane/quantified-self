import { describe, expect, it } from 'vitest';
import { ActivityInterface, DataPoolLength, DataSwimDistance } from '@sports-alliance/sports-lib';
import {
  getActivitySwimLengths,
  hasVisibleSwimLengths,
  normalizeSwimLength,
} from './event-swim-length.helper';

describe('event-swim-length.helper', () => {
  const rawSwimLength = {
    index: 1,
    lapIndex: 2,
    startDate: 1778945229000,
    endDate: 1778945254000,
    type: 'active',
    stroke: 'freestyle',
    strokes: 9,
    elapsedTime: 25,
    timerTime: 25,
    distance: 25,
    poolLength: 25,
    avgSpeed: 1,
    avgCadence: 22,
    avgHeartRate: 140,
    maxHeartRate: 150,
    swolf: 39,
    calories: 4,
  };

  it('normalizes valid swim length JSON', () => {
    const swimLength = normalizeSwimLength(rawSwimLength);

    expect(swimLength).toMatchObject({
      index: 1,
      lapIndex: 2,
      type: 'active',
      stroke: 'freestyle',
    });
    expect(swimLength?.distance).toBeInstanceOf(DataSwimDistance);
    expect(swimLength?.distance?.getValue()).toBe(25);
    expect(swimLength?.poolLength).toBeInstanceOf(DataPoolLength);
    expect(swimLength?.poolLength?.getValue()).toBe(25);
    expect(swimLength?.startDate).toBeInstanceOf(Date);
    expect(swimLength?.endDate).toBeInstanceOf(Date);
  });

  it('ignores malformed rows', () => {
    expect(normalizeSwimLength({ ...rawSwimLength, startDate: null })).toBeNull();
    expect(normalizeSwimLength({ ...rawSwimLength, index: 'bad' })).toBeNull();
  });

  it('reads official getSwimLengths implementations', () => {
    const activity = {
      getSwimLengths: () => [rawSwimLength],
    } as unknown as ActivityInterface;

    expect(getActivitySwimLengths(activity)).toHaveLength(1);
    expect(hasVisibleSwimLengths([activity])).toBe(true);
  });
});
