import { describe, expect, it } from 'vitest';
import {
  ActivityTypeGroups,
  ActivityTypes,
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
  resolveActivityCalendarQueryWindow,
} from './activity-calendar.helper';

function createEvent(
  id: string,
  startDate: Date,
  activityTypes: ActivityTypes[],
  durationSeconds: number | null,
): EventInterface {
  return {
    startDate,
    getID: () => id,
    getActivityTypesAsArray: () => activityTypes,
    getActivityTypesAsString: () => activityTypes.join(', '),
    getStat: (type: string) => type === DataDuration.type && durationSeconds !== null
      ? { getValue: () => durationSeconds }
      : null,
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
    expect(day?.tooltip).toContain('Duration unavailable');
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
