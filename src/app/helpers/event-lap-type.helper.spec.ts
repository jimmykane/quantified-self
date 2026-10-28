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
  isEventLapEndpointInActivity,
  getEventLapContextLabel,
  getEventLapTableGroups,
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

describe('event lap table grouping', () => {
  it.each([LapTypes.Manual, LapTypes.AutoLap, LapTypes.Distance, LapTypes.Time, LapTypes.Interval])(
    'appends one final segment to an unambiguous %s sequence without rewriting source data', type => {
      const first = createLap(type, 0, 120_000, 120, 300);
      const final = createLap(LapTypes.session_end, 120_000, 600_000, 480, 1700);
      const activity = createActivity([first, final]);
      const groups = getEventLapTableGroups(activity);

      expect(groups).toEqual([{ lapType: type, laps: [first, final] }]);
      expect(groups[0].laps[1]).toBe(final);
      expect(final.type).toBe(LapTypes.session_end);
      expect(final.getDuration().getValue()).toBe(480);
      expect(first.getDuration().getValue()).toBe(120);
      expect(activity.getLaps()).toEqual([first, final]);
      expect(getVisibleEventLaps(activity)).toEqual([first, final]);
      expect(isEventLapTypeAllowed(final.type, [])).toBe(false);
    },
  );

  it('orders the combined display chronologically without sorting the stored array', () => {
    const first = createLap(LapTypes.Manual, 0, 120_000);
    const second = createLap(LapTypes.Manual, 120_000, 599_000);
    const final = createLap(LapTypes.session_end, 599_000, 600_000, 1, 1);
    const activity = createActivity([final, second, first]);
    expect(getEventLapTableGroups(activity)).toEqual([{ lapType: LapTypes.Manual, laps: [first, second, final] }]);
    expect(activity.getLaps()).toEqual([final, second, first]);
  });

  it('allows a pause gap before the final segment', () => {
    const first = createLap(LapTypes.Manual, 0, 120_000);
    const final = createLap(LapTypes.session_end, 150_000, 600_000);
    expect(getEventLapTableGroups(createActivity([first, final]))).toHaveLength(1);
  });

  it('allows one second of activity-end timestamp rounding', () => {
    const first = createLap(LapTypes.Manual, 0, 120_000);
    const final = createLap(LapTypes.session_end, 120_000, 600_500);
    const activity = createActivity([first, final]);
    expect(getEventLapTableGroups(activity, [activity])).toEqual([{ lapType: LapTypes.Manual, laps: [first, final] }]);
  });

  it('keeps Manual, Auto and Session end separate rather than guessing a sequence', () => {
    const laps = [createLap(LapTypes.Manual, 0, 120_000), createLap(LapTypes.AutoLap, 0, 120_000),
      createLap(LapTypes.session_end, 120_000, 600_000)];
    expect(getEventLapTableGroups(createActivity(laps))).toEqual(laps.map(lap => ({ lapType: lap.type, laps: [lap] })));
  });

  it.each([
    ['overlapping final', 100_000, 600_000],
    ['non-terminal end', 120_000, 500_000],
    ['out-of-activity end', 120_000, 602_000],
    ['invalid date', NaN, 600_000],
    ['empty interval', 600_000, 600_000],
  ])('keeps an uncertain %s separate', (_reason, start, end) => {
    const first = createLap(LapTypes.Manual, 0, 120_000);
    const final = createLap(LapTypes.session_end, start as number, end as number);
    expect(getEventLapTableGroups(createActivity([first, final]))).toHaveLength(2);
  });

  it('keeps multiple session endings separate', () => {
    const laps = [createLap(LapTypes.Manual, 0, 120_000), createLap(LapTypes.session_end, 120_000, 300_000),
      createLap(LapTypes.session_end, 300_000, 600_000)];
    expect(getEventLapTableGroups(createActivity(laps))).toEqual([
      { lapType: LapTypes.Manual, laps: [laps[0]] }, { lapType: LapTypes.session_end, laps: laps.slice(1) },
    ]);
  });

  it('does not mistake differently named Session end aliases for a preceding lap sequence', () => {
    const first = createLap(LapTypes.session_end, 0, 120_000);
    const final = createLap(LapTypes.session_end, 120_000, 600_000);
    final.type = 'session_end' as LapTypes;
    expect(getEventLapTableGroups(createActivity([first, final]))).toHaveLength(2);
  });

  it('does not merge an overlapping sequence or a lap spanning activity legs', () => {
    const first = createLap(LapTypes.Manual, 0, 180_000);
    const second = createLap(LapTypes.Manual, 120_000, 300_000);
    const final = createLap(LapTypes.session_end, 300_000, 600_000);
    expect(getEventLapTableGroups(createActivity([first, second, final]))).toHaveLength(2);
    const activity = createActivity([first, final]);
    activity.startDate = new Date(100_000);
    expect(getEventLapTableGroups(activity)).toHaveLength(2);
  });

  it('keeps missing timing separate and preserves sole-lap duplicate suppression', () => {
    expect(getEventLapTableGroups(createActivityWithLapTypes([LapTypes.Manual, LapTypes.session_end]))).toHaveLength(2);
    expect(getEventLapTableGroups(createActivity([createLap(LapTypes.session_end)]))).toEqual([]);
    const partial = createLap(LapTypes.session_end, 120_000, 600_000, 480, 1700);
    expect(getEventLapTableGroups(createActivity([partial]))).toEqual([{ lapType: LapTypes.session_end, laps: [partial] }]);
  });

  it('decides grouping independently for each activity', () => {
    const first = createActivity([createLap(LapTypes.Manual, 0, 120_000), createLap(LapTypes.session_end, 120_000, 600_000)]);
    const second = createActivity([createLap(LapTypes.AutoLap, 0, 120_000), createLap(LapTypes.session_end, 120_000, 600_000)]);
    expect(getEventLapTableGroups(first, [first, second])[0].lapType).toBe(LapTypes.Manual);
    expect(getEventLapTableGroups(second, [first, second])[0].lapType).toBe(LapTypes.AutoLap);
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
  it('shows a shared multisport lap only in its ending leg without clipping its source interval', () => {
    const lap = createLap(LapTypes.Manual, 0, 450_000, 450, 1200);
    const first = createActivity([lap]);
    first.endDate = new Date(300_000);
    first.type = ActivityTypes.Swimming;
    const last = createActivity([createLap(LapTypes.Manual, 0, 450_000, 450, 1200)]);
    last.startDate = new Date(300_000);
    last.type = ActivityTypes.Running;
    expect(getVisibleEventLaps(first, [first, last])).toEqual([]);
    expect(getVisibleEventLaps(last, [first, last])).toHaveLength(1);
    expect(getEventLapContextLabel(last, last.getLaps()[0], [first, last])).toBe('Multisport lap');
    expect(isEventLapEndpointInActivity(first, lap)).toBe(false);
    expect(isEventLapEndpointInActivity(last, lap)).toBe(true);
    expect(+lap.startDate).toBe(0);
    expect(first.getLaps()).toEqual([lap]);
  });

  it('keeps uncertain ownership visible rather than dropping an unmatched source lap', () => {
    const lap = createLap(LapTypes.Manual, 0, 750_000, 700, 1200);
    const activity = createActivity([lap]);
    activity.startDate = new Date(100_000);
    expect(getVisibleEventLaps(activity, [activity])).toEqual([lap]);
    expect(getEventLapContextLabel(activity, lap, [activity])).toBe('Across activity legs');
    expect(isEventLapEndpointInActivity(activity, lap)).toBe(false);
  });

  it('does not label a single-sport terminal timing overrun as a lap across activity legs', () => {
    const lap = createLap(LapTypes.Manual, 300_000, 601_000, 301, 1200);
    const activity = createActivity([lap]);
    expect(getVisibleEventLaps(activity, [activity])).toEqual([lap]);
    expect(getEventLapContextLabel(activity, lap, [activity])).toBe('');
  });

  it('retains duplicate rows when multiple ending legs make ownership ambiguous', () => {
    const lap = createLap(LapTypes.Manual, 0, 450_000, 450, 1200);
    const first = createActivity([lap]);
    first.endDate = new Date(300_000);
    const owners = [createActivity([lap]), createActivity([lap])];
    owners.forEach(a => a.startDate = new Date(300_000));
    expect(getVisibleEventLaps(first, [first, ...owners])).toEqual([lap]);
  });

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

  it.each([
    ['activity', DataDuration.type], ['lap', DataDuration.type],
    ['activity', DataDistance.type], ['lap', DataDistance.type],
  ])('retains a sole lap when only the %s is missing %s', (side, type) => {
    const lap = createLap(LapTypes.session_end);
    const activity = createActivity([lap]);
    (side === 'activity' ? activity : lap).removeStat(type);

    expect(getVisibleEventLaps(activity)).toEqual([lap]);
    expect(hasVisibleEventLaps([activity])).toBe(true);
  });

  it.each([-1, NaN, Infinity])('retains a sole lap when its duration is invalid (%s)', duration => {
    const lap = createLap(LapTypes.session_end, 0, 600_000, duration);
    const activity = createActivity([lap]);

    expect(getVisibleEventLaps(activity)).toEqual([lap]);
  });

  it('does not treat matching zero distance alone as proof of a duplicate', () => {
    const lap = createLap(LapTypes.session_end, 0, 600_000, 600, 0);
    const activity = createActivity([lap]);
    activity.setDistance(new DataDistance(0));
    activity.removeStat(DataDuration.type);
    lap.removeStat(DataDuration.type);

    expect(getVisibleEventLaps(activity)).toEqual([lap]);
  });

  it.each([[1000, 0], [500, 500]])('retains a lap with non-positive time boundaries (%s, %s)', (start, end) => {
    const lap = createLap(LapTypes.session_end, start, end, 1, 1);
    const activity = createActivity([lap]);
    activity.endDate = new Date(1000);
    activity.setDuration(new DataDuration(1));
    activity.setDistance(new DataDistance(1));

    expect(getVisibleEventLaps(activity)).toEqual([lap]);
  });

  it.each([DataDuration.type, DataDistance.type])('still hides a confirmed duplicate when both omit %s', type => {
    const lap = createLap(LapTypes.session_end);
    const activity = createActivity([lap]);
    activity.removeStat(type);
    lap.removeStat(type);

    expect(getVisibleEventLaps(activity)).toEqual([]);
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
