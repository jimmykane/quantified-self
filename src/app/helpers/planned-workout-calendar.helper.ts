import type { ScheduledWorkoutV1, TrainingPlanV1 } from '@shared/training-plans';

export interface PlannedWorkoutCalendarEntry {
  workout: ScheduledWorkoutV1;
  planName: string | null;
}

export interface PlannedWorkoutCalendarDayOverlay {
  entries: PlannedWorkoutCalendarEntry[];
  visibleEntries: PlannedWorkoutCalendarEntry[];
  overflowCount: number;
  hasSkipped: boolean;
  ariaLabel: string;
}

export type PlannedWorkoutCalendarOverlay = Readonly<Record<string, PlannedWorkoutCalendarDayOverlay>>;

export function buildPlannedWorkoutCalendarOverlay(
  workouts: readonly ScheduledWorkoutV1[],
  plans: readonly TrainingPlanV1[] = [],
): PlannedWorkoutCalendarOverlay {
  const planNames = new Map(plans.map(plan => [plan.id, plan.name]));
  const activePlanIds = new Set(plans
    .filter(plan => plan.lifecycle === 'active')
    .map(plan => plan.id));
  const grouped = new Map<string, PlannedWorkoutCalendarEntry[]>();
  workouts
    .filter(workout => (
      workout.lifecycle !== 'deleted'
      && (workout.planId === null || activePlanIds.has(workout.planId))
    ))
    .forEach((workout) => {
      const entries = grouped.get(workout.localDate) ?? [];
      entries.push({
        workout,
        planName: workout.planId ? planNames.get(workout.planId) ?? 'Plan workout' : null,
      });
      grouped.set(workout.localDate, entries);
    });

  return Object.fromEntries([...grouped.entries()].map(([date, entries]) => {
    const sorted = [...entries].sort((left, right) => (
      Number(left.workout.lifecycle === 'skipped') - Number(right.workout.lifecycle === 'skipped')
      || left.workout.title.localeCompare(right.workout.title)
      || left.workout.id.localeCompare(right.workout.id)
    ));
    const skippedCount = sorted.filter(entry => entry.workout.lifecycle === 'skipped').length;
    const plannedCount = sorted.length - skippedCount;
    const parts = [
      plannedCount ? `${plannedCount} planned workout${plannedCount === 1 ? '' : 's'}` : '',
      skippedCount ? `${skippedCount} skipped workout${skippedCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    return [date, {
      entries: sorted,
      visibleEntries: sorted.slice(0, 2),
      overflowCount: Math.max(0, sorted.length - 2),
      hasSkipped: skippedCount > 0,
      ariaLabel: parts.join(', '),
    } satisfies PlannedWorkoutCalendarDayOverlay];
  }));
}
