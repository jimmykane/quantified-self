import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';
import { formatActivityCalendarDateParam, parseActivityCalendarDate } from './activity-calendar.helper';

type PlanRange = Pick<TrainingPlanV1, 'id' | 'startLocalDate' | 'endLocalDate'>;

export function resolvePlanScheduleDate(plan: PlanRange, requested: string | null, today: string): string {
  if (requested && requested >= plan.startLocalDate && requested <= plan.endLocalDate) return requested;
  return today >= plan.startLocalDate && today <= plan.endLocalDate ? today : plan.startLocalDate;
}

/** Date-only planning: local calendar arithmetic, never elapsed milliseconds across DST. */
export function buildPlanScheduleMonth(
  plan: PlanRange,
  workouts: readonly ScheduledWorkoutV1[],
  selectedDate: string,
  options: { today: string; locale: string; startOfWeek?: number | null },
) {
  const selected = resolvePlanScheduleDate(plan, selectedDate, options.today);
  const anchor = parseActivityCalendarDate(selected);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const weekStart = Number.isInteger(options.startOfWeek) && options.startOfWeek! >= 0 && options.startOfWeek! <= 6
    ? options.startOfWeek! : 1;
  const gridStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1 - (monthStart.getDay() - weekStart + 7) % 7);
  const formatter = new Intl.DateTimeFormat(options.locale, { dateStyle: 'full' });
  const weekdayFormatter = new Intl.DateTimeFormat(options.locale, { weekday: 'short' });
  const byDate = new Map<string, ScheduledWorkoutV1[]>();
  for (const workout of workouts) {
    if (workout.planId !== plan.id || workout.lifecycle === 'deleted') continue;
    const entries = byDate.get(workout.localDate) ?? [];
    entries.push(workout);
    byDate.set(workout.localDate, entries);
  }
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const localDate = formatActivityCalendarDateParam(date);
    const inRange = localDate >= plan.startLocalDate && localDate <= plan.endLocalDate;
    const entries = (byDate.get(localDate) ?? []).sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
    const skippedCount = entries.filter(workout => workout.lifecycle === 'skipped').length;
    const boundary = localDate === plan.startLocalDate && localDate === plan.endLocalDate ? 'Plan starts and ends'
      : localDate === plan.startLocalDate ? 'Plan starts' : localDate === plan.endLocalDate ? 'Plan ends' : null;
    return {
      localDate,
      dayNumber: date.getDate(),
      weekday: weekdayFormatter.format(date),
      inRange,
      inMonth: date.getMonth() === anchor.getMonth(),
      isToday: localDate === options.today,
      selected: localDate === selected,
      boundary,
      boundaryLabel: boundary === 'Plan starts and ends' ? 'Start/end' : boundary === 'Plan starts' ? 'Start' : boundary ? 'End' : null,
      entries,
      visibleEntries: entries.slice(0, 2),
      overflowCount: Math.max(0, entries.length - 2),
      ariaLabel: `${formatter.format(date)}. ${inRange
        ? `${entries.length} workout${entries.length === 1 ? '' : 's'}.${skippedCount ? ` ${skippedCount} skipped.` : ''}${boundary ? ` ${boundary}.` : ''}`
        : 'Outside this plan.'}${localDate === options.today ? ' Today.' : ''}`,
    };
  });
  const monthKey = selected.slice(0, 7);
  const previousMonth = formatActivityCalendarDateParam(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
  return {
    label: new Intl.DateTimeFormat(options.locale, { month: 'long', year: 'numeric' }).format(anchor),
    weekdays: days.slice(0, 7).map(day => day.weekday),
    // Keep the boundary weeks for context, but never reserve whole weeks outside the plan.
    days: days.filter((_, index) => days.slice(Math.floor(index / 7) * 7, Math.floor(index / 7) * 7 + 7).some(day => day.inRange)),
    previousDate: monthKey > plan.startLocalDate.slice(0, 7)
      ? (previousMonth < plan.startLocalDate ? plan.startLocalDate : previousMonth) : null,
    nextDate: monthKey < plan.endLocalDate.slice(0, 7)
      ? formatActivityCalendarDateParam(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)) : null,
    todayInRange: options.today >= plan.startLocalDate && options.today <= plan.endLocalDate,
  };
}
