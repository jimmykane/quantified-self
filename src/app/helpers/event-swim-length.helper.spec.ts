import { describe, expect, it } from 'vitest';
import {
  ActivityInterface,
  DataPoolLength,
  DataStrokeRate,
  DataSwimDistance,
  LapInterface,
  LapTypes,
} from '@sports-alliance/sports-lib';
import {
  getActivitySwimLengths,
  hasVisibleSwimLengths,
  normalizeSwimLength,
  getSwimStrokeLabel,
  getSwimLapStrokeLabels,
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
    expect(swimLength?.avgCadence).toBeInstanceOf(DataStrokeRate);
    expect(swimLength?.avgCadence?.getDisplayUnit()).toBe('spm');
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

  it('labels recorded strokes consistently, excludes rest, and preserves mixed or missing strokes', () => {
    const length = (stroke: string | null, type = 'active') => normalizeSwimLength({ ...rawSwimLength, stroke, type })!;
    expect(getSwimStrokeLabel([length('freestyle'), length(' FREESTYLE '), length('backstroke', ' REST ')])).toBe('Freestyle');
    expect(getSwimStrokeLabel([length('freestyle'), length('backstroke')])).toBe('Mixed');
    expect(getSwimStrokeLabel([length('drill')])).toBe('Drill');
    expect(getSwimStrokeLabel([length(null)])).toBe('');
    expect(getSwimStrokeLabel([length('freestyle', 'idle')])).toBe('');
  });

  it('matches stroke to the complete lap list without renumbering filtered lap types or using lap IDs', () => {
    const laps = [
      { lapId: 99, type: LapTypes.Manual },
      { lapId: 101, type: LapTypes.Interval },
      { lapId: 103, type: LapTypes.Manual },
      { lapId: 105, type: LapTypes.Manual },
    ] as LapInterface[];
    const activity = {
      getLaps: () => laps,
      getSwimLengths: () => [
        { ...rawSwimLength, lapIndex: 1, stroke: 'freestyle' },
        { ...rawSwimLength, lapIndex: 2, stroke: 'backstroke' },
        { ...rawSwimLength, lapIndex: 3, stroke: 'butterfly' },
        { ...rawSwimLength, lapIndex: 3, stroke: 'breaststroke' },
        { ...rawSwimLength, lapIndex: 4, type: 'idle', stroke: 'freestyle' },
        { ...rawSwimLength, lapIndex: null, stroke: 'drill' },
        { ...rawSwimLength, lapIndex: 1.5, stroke: 'drill' },
        { ...rawSwimLength, lapIndex: 10, stroke: 'drill' },
      ],
    } as unknown as ActivityInterface;
    const labels = getSwimLapStrokeLabels(activity);
    expect(laps.map(lap => labels.get(lap))).toEqual(['Freestyle', 'Backstroke', 'Mixed', '']);
  });
});
