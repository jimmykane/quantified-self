import { describe, expect, it } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
  DataAscent,
  DataDescent,
  DataDistance,
  DataDuration,
  DaysOfTheWeek,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import {
  buildActivityCalendarViewModel,
  formatActivityCalendarDateParam,
  formatActivityCalendarDuration,
  navigateActivityCalendarDate,
  normalizeActivityCalendarView,
  parseActivityCalendarDate,
  resolveActivityCalendarEventLabel,
  resolveActivityCalendarQueryWindow,
} from './activity-calendar.helper';

function createEvent(
  id: string,
  startDate: Date,
  activityTypes: ActivityTypes[],
  durationSeconds: number | null,
  metrics: {
    distanceMeters?: number | null;
    ascentMeters?: number | null;
    descentMeters?: number | null;
  } = {},
): EventInterface {
  const statValues: Record<string, number | null | undefined> = {
    [DataDuration.type]: durationSeconds,
    [DataDistance.type]: metrics.distanceMeters,
    [DataAscent.type]: metrics.ascentMeters,
    [DataDescent.type]: metrics.descentMeters,
  };
  return {
    startDate,
    getID: () => id,
    getActivityTypesAsArray: () => activityTypes,
    getActivityTypesAsString: () => activityTypes.join(', '),
    getStat: (type: string) => {
      const value = statValues[type];
      return value === null || value === undefined ? null : { getValue: () => value };
    },
  } as unknown as EventInterface;
}

describe('activity-calendar helper', () => {
  it('normalizes route views and strict local date parameters', () => {
    const fallback = new Date(2026, 7, 3, 18, 30);

    expect(normalizeActivityCalendarView('year')).toBe('year');
    expect(normalizeActivityCalendarView('agenda')).toBe('month');
    expect(formatActivityCalendarDateParam(parseActivityCalendarDate('2024-02-29', fallback))).toBe('2024-02-29');
    expect(formatActivityCalendarDateParam(parseActivityCalendarDate('2024-02-30', fallback))).toBe('2026-08-03');
  });

  it('resolves week, fixed month-grid, and year query windows', () => {
    const anchor = new Date(2026, 7, 5, 14, 0);
    const week = resolveActivityCalendarQueryWindow('week', anchor, DaysOfTheWeek.Monday);
    const month = resolveActivityCalendarQueryWindow('month', anchor, DaysOfTheWeek.Monday);
    const year = resolveActivityCalendarQueryWindow('year', anchor, DaysOfTheWeek.Monday);

    expect(new Date(week.startMs)).toEqual(new Date(2026, 7, 3));
    expect(new Date(week.endExclusiveMs)).toEqual(new Date(2026, 7, 10));
    expect(new Date(month.startMs)).toEqual(new Date(2026, 6, 27));
    expect(new Date(month.endExclusiveMs)).toEqual(new Date(2026, 8, 7));
    expect(new Date(year.startMs)).toEqual(new Date(2026, 0, 1));
    expect(new Date(year.endExclusiveMs)).toEqual(new Date(2027, 0, 1));
  });

  it('navigates calendar pages without overflowing short months', () => {
    expect(formatActivityCalendarDateParam(navigateActivityCalendarDate(new Date(2025, 0, 31), 'month', 1)))
      .toBe('2025-02-28');
    expect(formatActivityCalendarDateParam(navigateActivityCalendarDate(new Date(2024, 1, 29), 'year', 1)))
      .toBe('2025-02-28');
    expect(formatActivityCalendarDateParam(navigateActivityCalendarDate(new Date(2026, 7, 3), 'week', -1)))
      .toBe('2026-07-27');
  });

  it('builds a month grid and aggregates duration by local day and sport family', () => {
    const events = [
      createEvent('run-1', new Date(2026, 7, 3, 7), [ActivityTypes.Running], 3600),
      createEvent('run-2', new Date(2026, 7, 3, 18), [ActivityTypes.Running], 1800),
      createEvent('ride-1', new Date(2026, 7, 3, 12), [ActivityTypes.Cycling], 7200),
    ];
    const model = buildActivityCalendarViewModel(events, {
      view: 'month',
      anchorDate: new Date(2026, 7, 15),
      startOfWeek: DaysOfTheWeek.Monday,
      locale: 'en-US',
      now: new Date(2026, 7, 3),
    });
    const day = model.months[0].days.find(candidate => candidate.dateKey === '2026-08-03');

    expect(model.months[0].days).toHaveLength(42);
    expect(day?.eventCount).toBe(3);
    expect(day?.totalDurationSeconds).toBe(12_600);
    expect(day?.families.map(family => family.activityTypeGroup)).toEqual([
      ActivityTypeGroups.CyclingGroup,
      ActivityTypeGroups.RunningGroup,
    ]);
    expect(day?.families[0].durationSeconds).toBe(7200);
    expect(day?.families[1].durationSeconds).toBe(5400);
    expect(day?.families[0].sizePercent).toBeGreaterThan(day?.families[1].sizePercent || 0);
    expect(day?.families[0].compactDiameterPx - (day?.families[1].compactDiameterPx || 0)).toBeGreaterThanOrEqual(2);
    expect(day?.isToday).toBe(true);
  });

  it('uses one neutral multisport family instead of duplicating event duration', () => {
    const event = createEvent(
      'multi-1',
      new Date(2026, 7, 8, 8),
      [ActivityTypes.Running, ActivityTypes.Cycling],
      5400,
    );
    const model = buildActivityCalendarViewModel([event], {
      view: 'week',
      anchorDate: new Date(2026, 7, 8),
      startOfWeek: DaysOfTheWeek.Monday,
      locale: 'en-US',
    });
    const day = model.months[0].days.find(candidate => candidate.eventCount > 0);

    expect(day?.families).toHaveLength(1);
    expect(day?.families[0]).toMatchObject({
      id: 'multisport',
      label: 'Multisport',
      durationSeconds: 5400,
    });
    expect(day?.totalDurationSeconds).toBe(5400);
  });

  it('summarizes family volume only inside the primary period', () => {
    const model = buildActivityCalendarViewModel([
      createEvent('inside-1', new Date(2026, 7, 3, 8), [ActivityTypes.Running], 3600, {
        distanceMeters: 10_000,
        ascentMeters: 500,
        descentMeters: 450,
      }),
      createEvent('inside-2', new Date(2026, 7, 20, 8), [ActivityTypes.Cycling], 1800, {
        distanceMeters: 5000,
        ascentMeters: 250,
        descentMeters: 200,
      }),
      createEvent('leading-grid-day', new Date(2026, 6, 31, 8), [ActivityTypes.Cycling], 7200, {
        distanceMeters: 50_000,
        ascentMeters: 1500,
        descentMeters: 1400,
      }),
      createEvent('trailing-grid-day', new Date(2026, 8, 1, 8), [ActivityTypes.Running], 5400, {
        distanceMeters: 15_000,
        ascentMeters: 800,
        descentMeters: 700,
      }),
    ], {
      view: 'month',
      anchorDate: new Date(2026, 7, 15),
      startOfWeek: DaysOfTheWeek.Monday,
      locale: 'en-US',
    });

    expect(model.summary).toMatchObject({
      totalDurationSeconds: 5400,
      totalDistanceMeters: 15_000,
      totalAscentMeters: 750,
      totalDescentMeters: 650,
    });
    expect(model.summary.families.map(family => ({
      id: family.id,
      duration: family.metrics.duration.value,
      distance: family.metrics.distance.value,
    }))).toEqual([
      { id: ActivityTypeGroups.RunningGroup, duration: 3600, distance: 10_000 },
      { id: ActivityTypeGroups.CyclingGroup, duration: 1800, distance: 5000 },
    ]);
  });

  it('excludes lift-served ascent while retaining descent for downhill sports', () => {
    const model = buildActivityCalendarViewModel([
      createEvent('downhill-mtb', new Date(2026, 7, 3, 8), [ActivityTypes.DownhillCycling], 3600, {
        ascentMeters: 900,
        descentMeters: 1200,
      }),
      createEvent('trail-mtb', new Date(2026, 7, 4, 8), [ActivityTypes.MountainBiking], 3600, {
        ascentMeters: 450,
        descentMeters: 500,
      }),
      createEvent('alpine', new Date(2026, 7, 5, 8), [ActivityTypes.AlpineSki], 3600, {
        ascentMeters: 700,
        descentMeters: 800,
      }),
      createEvent('snowboard', new Date(2026, 7, 6, 8), [ActivityTypes.Snowboard], 3600, {
        ascentMeters: 650,
        descentMeters: 700,
      }),
      createEvent('ski-tour', new Date(2026, 7, 7, 8), [ActivityTypes.SkiTouring], 3600, {
        ascentMeters: 600,
        descentMeters: 650,
      }),
      createEvent('swim', new Date(2026, 7, 8, 8), [ActivityTypes.Swimming], 3600, {
        ascentMeters: 30,
        descentMeters: 30,
      }),
    ], {
      view: 'month',
      anchorDate: new Date(2026, 7, 15),
      startOfWeek: DaysOfTheWeek.Monday,
      locale: 'en-US',
    });
    const mountainBiking = model.summary.families.find(family => (
      family.activityTypeGroup === ActivityTypeGroups.MountainBikingGroup
    ));
    const winterSports = model.summary.families.find(family => (
      family.activityTypeGroup === ActivityTypeGroups.WinterSportsGroup
    ));
    const swimming = model.summary.families.find(family => (
      family.activityTypeGroup === ActivityTypeGroups.SwimmingGroup
    ));

    expect(model.summary.totalAscentMeters).toBe(1050);
    expect(model.summary.totalDescentMeters).toBe(3850);
    expect(mountainBiking?.metrics.ascent).toEqual({
      value: 450,
      eligibleEventCount: 1,
      recordedEventCount: 1,
    });
    expect(mountainBiking?.metrics.descent.value).toBe(1700);
    expect(winterSports?.metrics.ascent).toEqual({
      value: 600,
      eligibleEventCount: 1,
      recordedEventCount: 1,
    });
    expect(winterSports?.metrics.descent.value).toBe(2150);
    expect(swimming?.metrics.ascent.eligibleEventCount).toBe(0);
    expect(swimming?.metrics.descent.eligibleEventCount).toBe(0);
  });

  it('honors normalized user-configured ascent and descent summary exclusions', () => {
    const model = buildActivityCalendarViewModel([
      createEvent('run', new Date(2026, 7, 3, 8), [ActivityTypes.Running], 3600, {
        ascentMeters: 100,
        descentMeters: 90,
      }),
      createEvent('ride', new Date(2026, 7, 4, 8), [ActivityTypes.Cycling], 3600, {
        ascentMeters: 200,
        descentMeters: 180,
      }),
    ], {
      view: 'month',
      anchorDate: new Date(2026, 7, 15),
      startOfWeek: DaysOfTheWeek.Monday,
      summariesSettings: {
        removeAscentForEventTypes: [' running '],
        removeDescentForEventTypes: ['CYCLING'],
      },
      locale: 'en-US',
    });
    const running = model.summary.families.find(family => (
      family.activityTypeGroup === ActivityTypeGroups.RunningGroup
    ));
    const cycling = model.summary.families.find(family => (
      family.activityTypeGroup === ActivityTypeGroups.CyclingGroup
    ));

    expect(model.summary.totalAscentMeters).toBe(200);
    expect(model.summary.totalDescentMeters).toBe(90);
    expect(running?.metrics.ascent.eligibleEventCount).toBe(0);
    expect(running?.metrics.descent.value).toBe(90);
    expect(cycling?.metrics.ascent.value).toBe(200);
    expect(cycling?.metrics.descent.eligibleEventCount).toBe(0);
  });

  it('keeps equal durations equal in separated layouts while nesting compact markers', () => {
    const model = buildActivityCalendarViewModel([
      createEvent('run-1', new Date(2026, 7, 8, 8), [ActivityTypes.Running], 3600),
      createEvent('ride-1', new Date(2026, 7, 8, 10), [ActivityTypes.Cycling], 3600),
    ], {
      view: 'month',
      anchorDate: new Date(2026, 7, 8),
      startOfWeek: DaysOfTheWeek.Monday,
      locale: 'en-US',
    });
    const families = model.months[0].days.find(day => day.eventCount > 0)?.families || [];

    expect(families).toHaveLength(2);
    expect(families[0].sizePercent).toBe(families[1].sizePercent);
    expect(families[0].diameterPx).toBe(families[1].diameterPx);
    expect(families[0].compactDiameterPx - families[1].compactDiameterPx).toBeGreaterThanOrEqual(2);
  });

  it('falls back from generic event names to a meaningful activity label', () => {
    const event = {
      name: '2026-08-03T08:30:00.000Z',
      description: 'New Event',
      getActivityTypesAsString: () => 'Running',
    } as unknown as EventInterface;

    expect(resolveActivityCalendarEventLabel(event)).toBe('Running');
  });

  it('limits visible family markers and retains unknown-duration activities', () => {
    const activityTypes = [
      ActivityTypes.Running,
      ActivityTypes.Cycling,
      ActivityTypes.Swimming,
      ActivityTypes.Hiking,
    ];
    const events = activityTypes.map((activityType, index) => createEvent(
      `event-${index}`,
      new Date(2026, 7, 10, 8 + index),
      [activityType],
      index === 3 ? null : (index + 1) * 600,
    ));
    const model = buildActivityCalendarViewModel(events, {
      view: 'month',
      anchorDate: new Date(2026, 7, 1),
      startOfWeek: DaysOfTheWeek.Monday,
      locale: 'en-US',
    });
    const day = model.months[0].days.find(candidate => candidate.dateKey === '2026-08-10');

    expect(day?.families).toHaveLength(4);
    expect(day?.visibleFamilies).toHaveLength(3);
    expect(day?.overflowFamilyCount).toBe(1);
    expect(day?.families.some(family => family.hasUnknownDuration)).toBe(true);
    expect(day?.ariaLabel).toContain('Duration unavailable');
  });

  it('builds twelve fixed month calendars for the yearly view', () => {
    const model = buildActivityCalendarViewModel([], {
      view: 'year',
      anchorDate: new Date(2026, 7, 3),
      startOfWeek: DaysOfTheWeek.Sunday,
      locale: 'en-US',
    });

    expect(model.periodLabel).toBe('2026');
    expect(model.months).toHaveLength(12);
    expect(model.months.every(month => month.days.length === 42)).toBe(true);
    expect(model.months[0].weekdayLabels[0]).toMatch(/^Sun/);
  });

  it('formats compact duration labels', () => {
    expect(formatActivityCalendarDuration(0)).toBe('0m');
    expect(formatActivityCalendarDuration(30)).toBe('<1m');
    expect(formatActivityCalendarDuration(3600)).toBe('1h');
    expect(formatActivityCalendarDuration(4500)).toBe('1h 15m');
    expect(formatActivityCalendarDuration(0, true)).toBe('Duration unavailable');
  });
});
