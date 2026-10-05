import {
  ActivityInterface, ActivityTypes, DataDistance, DataDuration, EventImporterJSON,
  LapInterface, LapTypes,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildAllowedEventLapTypeSet,
  getVisibleEventLaps,
  hasVisibleEventLaps,
  isEventLapTypeAllowed,
  normalizeEventLapType,
} from './event-lap-type.helper';

function createActivityWithLapTypes(types: Array<LapTypes | string | null | undefined>): ActivityInterface {
  return {
    getLaps: () => types.map((type) => ({ type }) as LapInterface),
  } as ActivityInterface;
}

describe('event lap type helper', () => {
  it('normalizes known aliases and preserves custom lap types', () => {
    expect(normalizeEventLapType('auto')).toBe(LapTypes.AutoLap);
    expect(normalizeEventLapType('Custom Lap')).toBe('Custom Lap');
  });

  it('filters missing, blank, and excluded lap types', () => {
    expect(isEventLapTypeAllowed(undefined, [])).toBe(false);
    expect(isEventLapTypeAllowed(null, [])).toBe(false);
    expect(isEventLapTypeAllowed('   ', [])).toBe(false);
    expect(isEventLapTypeAllowed(LapTypes.session_end, [])).toBe(false);
    expect(isEventLapTypeAllowed(LapTypes.Manual, [])).toBe(true);
  });

  it('builds an allowlist without missing or excluded lap types', () => {
    expect(buildAllowedEventLapTypeSet([
      undefined,
      ' ',
      LapTypes.session_end,
      LapTypes.Manual,
    ])).toEqual(new Set([LapTypes.Manual]));
  });

  it('only reports visible laps when at least one lap has a renderable type', () => {
    expect(hasVisibleEventLaps([
      createActivityWithLapTypes([undefined, null, ' ']),
    ])).toBe(false);
    expect(hasVisibleEventLaps([
      createActivityWithLapTypes([undefined, LapTypes.Manual]),
    ])).toBe(true);
  });
});

function createLap(type: LapTypes, start = 0, end = 600_000, duration = 600, distance = 2000): LapInterface {
  return EventImporterJSON.getLapFromJSON({
    lapId: 1, startDate: start, endDate: end, startIndex: null, endIndex: null, type,
    stats: { [DataDuration.type]: duration, [DataDistance.type]: distance },
  }, 0);
}

function createActivity(laps: LapInterface[]): ActivityInterface {
  const activity = EventImporterJSON.getActivityFromJSON({
    name: null, startDate: 0, endDate: 600_000, type: ActivityTypes.MountainBiking,
    powerMeter: false, trainer: false, creator: { name: 'Test', devices: [] },
    stats: { [DataDuration.type]: 600, [DataDistance.type]: 2000 },
    laps: [], streams: [], intensityZones: [], events: [],
  });
  laps.forEach(lap => activity.addLap(lap));
  return activity;
}

describe('event lap table visibility', () => {
  it.each([LapTypes.session_end, LapTypes.Manual, LapTypes.Time, LapTypes.Distance])(
    'hides a sole %s lap that duplicates the whole activity', type => {
      const activity = createActivity([createLap(type)]);
      expect(getVisibleEventLaps(activity)).toEqual([]);
      expect(hasVisibleEventLaps([activity])).toBe(false);
    },
  );

  it('allows timestamp and summary rounding for a whole-activity duplicate', () => {
    const activity = createActivity([createLap(LapTypes.session_end, 1000, 599_000, 599.5, 1999.5)]);
    expect(getVisibleEventLaps(activity)).toEqual([]);
  });

  it('retains a Garmin final segment after a manual split without changing the activity', () => {
    const manual = createLap(LapTypes.Manual, 0, 120_000, 120, 300);
    const final = createLap(LapTypes.session_end, 120_000, 600_000, 480, 1700);
    const activity = createActivity([manual, final]);
    expect(getVisibleEventLaps(activity)).toEqual([manual, final]);
    expect(activity.getLaps()).toEqual([manual, final]);
    expect(hasVisibleEventLaps([activity])).toBe(true);
    expect(isEventLapTypeAllowed(final.type, [])).toBe(false);
  });

  it('retains even a short final segment', () => {
    const laps = [
      createLap(LapTypes.Manual, 0, 599_000, 599, 1999),
      createLap(LapTypes.session_end, 599_000, 600_000, 1, 1),
    ];
    expect(getVisibleEventLaps(createActivity(laps))).toEqual(laps);
  });

  it.each([LapTypes.Manual, LapTypes.Time, LapTypes.Distance])(
    'retains Suunto-style %s laps including the final partial lap', type => {
      const laps = [createLap(type, 0, 480_000, 480, 1600), createLap(type, 480_000, 600_000, 120, 400)];
      expect(getVisibleEventLaps(createActivity(laps))).toEqual(laps);
    },
  );

  it.each([
    [2000, 600_000, 600, 2000],
    [0, 598_000, 600, 2000],
    [0, 600_000, 480, 2000],
    [0, 600_000, 600, 1700],
  ])('retains a sole lap with differing boundaries or totals (%s, %s, %s, %s)', (start, end, duration, distance) => {
    const lap = createLap(LapTypes.session_end, start, end, duration, distance);
    expect(getVisibleEventLaps(createActivity([lap]))).toEqual([lap]);
  });

  it('does not infer a whole-activity duplicate from missing dates or totals', () => {
    const lap = createLap(LapTypes.session_end);
    const activity = createActivity([lap]);
    activity.clearStats();
    expect(getVisibleEventLaps(activity)).toEqual([lap]);
    expect(getVisibleEventLaps(createActivityWithLapTypes([LapTypes.session_end]))).toHaveLength(1);
  });

  it('filters missing lap types and keeps activity visibility independent', () => {
    const hidden = createActivity([createLap(LapTypes.session_end)]);
    const final = createLap(LapTypes.session_end, 120_000, 600_000, 480, 1700);
    const visible = createActivity([final]);
    expect(getVisibleEventLaps(createActivityWithLapTypes([undefined, null, ' ', LapTypes.session_end])))
      .toEqual([{ type: LapTypes.session_end }]);
    expect(hasVisibleEventLaps([hidden, visible])).toBe(true);
    expect(hasVisibleEventLaps(null)).toBe(false);
  });
});
