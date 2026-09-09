import { ActivityTypes } from '@sports-alliance/sports-lib';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import { buildPlanScheduleMonth, resolvePlanScheduleDate } from './plan-schedule-calendar.helper';

describe('plan schedule calendar', () => {
  const plan = { id: 'plan', startLocalDate: '2026-09-09', endLocalDate: '2026-10-06' };
  const options = { today: '2026-09-12', locale: 'en-US' };
  const workout = (id: string, lifecycle: ScheduledWorkoutV1['lifecycle'] = 'planned', planId: string | null = 'plan'): ScheduledWorkoutV1 => ({
    schemaVersion: 1, id, planId, localDate: '2026-09-12', lifecycle, title: id,
    structure: { version: 1, sport: ActivityTypes.Running, nodes: [] }, revision: 1, createdAtMs: 1, updatedAtMs: 1,
  });

  it('opens today inside the range, otherwise the start; preserves a valid selection', () => {
    expect(resolvePlanScheduleDate(plan, null, options.today)).toBe(options.today);
    expect(resolvePlanScheduleDate(plan, null, '2027-01-01')).toBe(plan.startLocalDate);
    expect(resolvePlanScheduleDate(plan, null, '2026-01-01')).toBe(plan.startLocalDate);
    expect(resolvePlanScheduleDate(plan, '2026-10-01', options.today)).toBe('2026-10-01');
    expect(resolvePlanScheduleDate(plan, '2027-01-01', options.today)).toBe(options.today);
  });

  it('shows inclusive boundaries and empty days, bounds month navigation, and marks today', () => {
    const month = buildPlanScheduleMonth(plan, [], options.today, options);
    expect(month.days).toHaveLength(35);
    expect(month.label).toBe('September 2026');
    expect(month.weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(month.previousDate).toBeNull();
    expect(month.nextDate).toBe('2026-10-01');
    expect(month.days.find(day => day.localDate === plan.startLocalDate)).toMatchObject({ boundary: 'Plan starts', inRange: true });
    expect(month.days.find(day => day.localDate === '2026-09-08')).toMatchObject({ inRange: false });
    expect(month.days.find(day => day.localDate === options.today)).toMatchObject({ selected: true, isToday: true, entries: [] });
    const last = buildPlanScheduleMonth(plan, [], '2026-10-01', options);
    expect(last.previousDate).toBe(plan.startLocalDate);
    expect(last.nextDate).toBeNull();
    expect(last.days.find(day => day.localDate === plan.endLocalDate)).toMatchObject({ boundary: 'Plan ends', inRange: true });
    expect(last.days.find(day => day.localDate === '2026-10-07')).toMatchObject({ inRange: false });
  });

  it('isolates the selected plan, excludes deleted workouts, and retains skipped/multiple workouts without totals', () => {
    const month = buildPlanScheduleMonth(plan, [workout('b'), workout('a', 'skipped'), workout('c'),
      workout('deleted', 'deleted'), workout('standalone', 'planned', null), workout('other', 'planned', 'other')], options.today, options);
    const day = month.days.find(item => item.selected)!;
    expect(day.entries.map(entry => entry.id)).toEqual(['a', 'b', 'c']);
    expect(day.visibleEntries).toHaveLength(2);
    expect(day.overflowCount).toBe(1);
    expect(day.ariaLabel).toContain('3 workouts. 1 skipped.');
    expect(day).not.toHaveProperty('totalDurationSeconds');
  });

  it('respects Sunday preferences and local dates across DST and leap years', () => {
    const leap = { id: 'plan', startLocalDate: '2024-02-29', endLocalDate: '2024-03-31' };
    const month = buildPlanScheduleMonth(leap, [], '2024-03-15', { ...options, startOfWeek: 0 });
    expect(month.weekdays[0]).toBe('Sun');
    expect(month.days[0].localDate).toBe('2024-02-25');
    expect(new Set(month.days.map(day => day.localDate)).size).toBe(42);
    expect(month.days.some(day => day.localDate === '2024-02-29')).toBe(true);
    expect(month.days.filter(day => day.inRange)).toHaveLength(32);
  });

  it('handles a single-day plan and a 366-day cross-year plan without unbounded rendering', () => {
    const single = buildPlanScheduleMonth({ ...plan, endLocalDate: plan.startLocalDate }, [], plan.startLocalDate, options);
    expect(single.days.filter(day => day.inRange)).toHaveLength(1);
    expect(single.days.find(day => day.inRange)?.boundary).toBe('Plan starts and ends');
    expect(single.previousDate).toBeNull();
    expect(single.nextDate).toBeNull();
    const year = buildPlanScheduleMonth({ id: 'plan', startLocalDate: '2026-09-09', endLocalDate: '2027-09-09' }, [], '2026-12-31', options);
    expect(year.days).toHaveLength(42);
    expect(year.nextDate).toBe('2027-01-01');
  });
});
