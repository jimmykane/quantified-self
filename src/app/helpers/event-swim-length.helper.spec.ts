import { describe, expect, it } from 'vitest';
import {
  ActivityInterface,
  DataActiveLap,
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

  it('corrects recorded FIT lengths at overlapping active/rest lap boundaries without changing source lengths', () => {
    // Native FIT lap timestamps can end a second after the next lap starts.
    const start = 1563714899000;
    const lap = (offset: number, active: boolean) => ({
      startDate: new Date(start + offset),
      getStat: (type: string) => type === DataActiveLap.type ? new DataActiveLap(active) : undefined,
    }) as unknown as LapInterface;
    const laps = [lap(0, true), lap(54000, false), lap(70000, true)];
    const sourceLengths = [
      { ...rawSwimLength, lapIndex: 1, startDate: start, endDate: start + 28000 },
      { ...rawSwimLength, lapIndex: 1, type: 'idle', startDate: start + 54000, endDate: start + 70233 },
      { ...rawSwimLength, lapIndex: 2, stroke: 'backstroke', startDate: start + 70000, endDate: start + 98875 },
      { ...rawSwimLength, lapIndex: 3, stroke: 'freestyle', startDate: start + 99000, endDate: start + 128000 },
    ];
    const activity = { getLaps: () => laps, getSwimLengths: () => sourceLengths } as unknown as ActivityInterface;

    expect(getActivitySwimLengths(activity).map(length => length.lapIndex)).toEqual([1, 2, 3, 3]);
    expect(laps.map(lap => getSwimLapStrokeLabels(activity).get(lap))).toEqual(['Freestyle', '', 'Mixed']);
    expect(sourceLengths.map(length => length.lapIndex)).toEqual([1, 1, 2, 3]);
  });

  it('preserves recorded indices when lap state is absent, agrees, or the boundary is ambiguous', () => {
    const lap = (active: boolean | undefined) => ({
      startDate: new Date(rawSwimLength.startDate),
      getStat: (type: string) => type === DataActiveLap.type && active !== undefined ? new DataActiveLap(active) : undefined,
    }) as unknown as LapInterface;
    for (const laps of [[lap(undefined), lap(true)], [lap(true), lap(false)], [lap(false), lap(true), lap(true)]]) {
      const activity = {
        getLaps: () => laps,
        getSwimLengths: () => [{ ...rawSwimLength, lapIndex: 1 }],
      } as unknown as ActivityInterface;
      expect(getActivitySwimLengths(activity)[0].lapIndex).toBe(1);
    }
  });

  it('keeps an explicitly inactive lap blank when a mismatched active length has no exact boundary match', () => {
    const restLap = {
      startDate: new Date(rawSwimLength.startDate - 1000),
      getStat: (type: string) => type === DataActiveLap.type ? new DataActiveLap(false) : undefined,
    } as unknown as LapInterface;
    const activity = {
      getLaps: () => [restLap],
      getSwimLengths: () => [{ ...rawSwimLength, lapIndex: 1 }],
    } as unknown as ActivityInterface;
    expect(getActivitySwimLengths(activity)[0].lapIndex).toBe(1);
    expect(getSwimLapStrokeLabels(activity).get(restLap)).toBe('');
  });
});
