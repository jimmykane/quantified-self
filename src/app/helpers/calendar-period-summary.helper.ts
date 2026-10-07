import { DataAscent, DataDistance, DataDuration, type EventInterface, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { aggregateWorkoutAnalysesV1, analyzeWorkoutStructureV1, type WorkoutAnalysisAggregateV1 } from '@shared/planned-workout-analysis';
import type { ScheduledWorkoutV1 } from '@shared/training-plans';
import type { TrainingWorkoutCompletionV1 } from '@shared/training-workout-completion';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE, resolveDashboardFormTrainingStressScore } from './dashboard-form.helper';
import { buildActivityCalendarPeriodSummary, type ActivityCalendarQueryWindow } from './activity-calendar.helper';
import type { SummaryStatsSettingsLike } from './summary-stats.helper';

export interface CalendarPeriodSource<T> {
  status: 'loading' | 'ready' | 'error';
  data: T;
  complete: boolean;
}
export interface CalendarPeriodSchedule {
  state: { activePlanId: string | null };
  workouts: ScheduledWorkoutV1[];
}
export interface CalendarPeriodMetric { label: string; text: string; coverage: string }
export interface CalendarPeriodSummary {
  period: 'week' | 'month';
  periodKey: string;
  recordedStatus: CalendarPeriodSource<unknown>['status'];
  completionStatus: CalendarPeriodSource<unknown>['status'];
  recordedCount: number | null;
  recordedComplete: boolean;
  scheduleComplete: boolean;
  recordedMetrics: CalendarPeriodMetric[];
  scheduledCount: number | null;
  completedCount: number | null;
  skippedCount: number | null;
  remainingCount: number | null;
  changedSinceCompletionCount: number;
  planned: WorkoutAnalysisAggregateV1 | null;
  remaining: WorkoutAnalysisAggregateV1 | null;
  plannedText: string;
  remainingText: string;
  warnings: string[];
  loading: boolean;
}

/** Calendar copy keeps the analysis limits visible without exposing its internal vocabulary. */
function formatCalendarWorkoutTotals(
  analysis: WorkoutAnalysisAggregateV1 | null,
  unitSettings?: UserUnitSettingsInterface | null,
): string {
  if (!analysis) return 'Totals unavailable';
  if (analysis.workoutCount === 0) return analysis.sourceComplete ? 'No workouts' : 'Workouts may be missing';
  const { duration, distance, earlyLapSteps } = analysis.summary;
  const parts: string[] = [];
  if (duration.coveredSubtotalRange) {
    const minimum = resolveUnitAwareDisplayFromValue(DataDuration.type, duration.coveredSubtotalRange.minimumSeconds, unitSettings)?.text;
    const maximum = resolveUnitAwareDisplayFromValue(DataDuration.type, duration.coveredSubtotalRange.maximumSeconds, unitSettings)?.text;
    if (minimum && maximum) {
      const range = minimum === maximum ? minimum : `${minimum}–${maximum}`;
      parts.push(`${duration.estimatedSteps > 0 ? 'About ' : ''}${range}${!analysis.sourceComplete ? ' from workouts loaded' : ''}`);
    }
  }
  if (duration.unknownSteps > 0) parts.push(`${parts.length ? 'Plus steps' : 'Steps'} with no set time`);
  else if (!parts.length) parts.push('Time not set');
  if (distance.exactSteps > 0) {
    const display = resolveUnitAwareDisplayFromValue(DataDistance.type, distance.exactSubtotalMeters, unitSettings);
    if (display) parts.push(`${display.text}${distance.coverage === 'partial' ? ' distance set' : ''}`);
  }
  if (earlyLapSteps > 0) parts.push('Some steps can finish earlier with Lap');
  return parts.join(' · ');
}

/** The period summary and calendar markers must use the same exact-link validity rules. */
export function resolveCalendarCompletionCoverage(
  workouts: readonly ScheduledWorkoutV1[],
  completions: CalendarPeriodSource<readonly TrainingWorkoutCompletionV1[]>,
): { complete: boolean; linkedWorkoutIds: string[]; changedSinceCompletionCount: number } {
  if (completions.status !== 'ready') return { complete: false, linkedWorkoutIds: [], changedSinceCompletionCount: 0 };
  const links = new Map<string, TrainingWorkoutCompletionV1>();
  const ambiguous = new Set<string>();
  for (const link of completions.data) {
    if (links.has(link.workoutId)) ambiguous.add(link.workoutId);
    links.set(link.workoutId, link);
  }
  let complete = completions.complete;
  const linkedWorkoutIds: string[] = [];
  let changedSinceCompletionCount = 0;
  for (const workout of workouts) {
    const link = links.get(workout.id);
    if (ambiguous.has(workout.id) || (link && (link.workoutRevisionAtLink > workout.revision
      || (link.workoutRevisionAtLink === workout.revision && link.planId !== workout.planId)))) {
      complete = false;
      continue;
    }
    if (!link) continue;
    linkedWorkoutIds.push(workout.id);
    if (link.workoutRevisionAtLink !== workout.revision) changedSinceCompletionCount++;
  }
  return { complete, linkedWorkoutIds, changedSinceCompletionCount };
}

/** Calendar-local period volume. Completion is stored evidence, never inferred adherence. */
export function buildCalendarPeriodSummary(input: {
  period?: 'week' | 'month';
  window: ActivityCalendarQueryWindow;
  startLocalDate: string;
  endLocalDate: string;
  events: CalendarPeriodSource<readonly EventInterface[]>;
  schedule: CalendarPeriodSource<CalendarPeriodSchedule | null>;
  completions: CalendarPeriodSource<readonly TrainingWorkoutCompletionV1[]>;
  unitSettings?: UserUnitSettingsInterface | null;
  locale?: string;
  summariesSettings?: SummaryStatsSettingsLike | null;
}): CalendarPeriodSummary {
  const { events, schedule, completions, unitSettings, locale } = input;
  const recordedWarnings: string[] = [];
  const planningWarnings: string[] = [];
  const number = new Intl.NumberFormat(locale);
  const recorded = new Map<string, EventInterface>();
  if (events.status === 'ready') for (const event of events.data) {
    const time = event.startDate?.getTime();
    if (time >= input.window.startMs && time < input.window.endExclusiveMs) recorded.set(event.getID(), event);
  }
  if (events.status === 'error') recordedWarnings.push('Activities could not be loaded. Try again to see your totals.');
  else if (events.status === 'ready' && !events.complete) recordedWarnings.push('Some activities may be missing. Totals include only the activities loaded so far.');
  const recordedMetrics = [
    { label: 'Duration', type: DataDuration.type },
    { label: 'Distance', type: DataDistance.type },
    { label: 'Training load', type: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE },
  ].map(({ label, type }) => {
    let sum = 0;
    let sources = 0;
    for (const event of recorded.values()) {
      const stat = event.getStat(type);
      const value = type === DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE
        ? resolveDashboardFormTrainingStressScore(event) : stat ? stat.getValue() : null;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) { sum += value; sources++; }
    }
    const display = sources > 0 && Number.isFinite(sum) ? resolveUnitAwareDisplayFromValue(type, sum, unitSettings) : null;
    const complete = events.status === 'ready' && events.complete && sources === recorded.size;
    return { label, text: display?.text ?? 'Unavailable', coverage: display && !complete
      ? `From ${number.format(sources)} of ${number.format(recorded.size)} activities loaded` : '' };
  });
  if (input.period === 'month') {
    const ascent = buildActivityCalendarPeriodSummary([...recorded.values()], input.summariesSettings);
    const eligible = ascent.families.reduce((count, family) => count + family.metrics.ascent.eligibleEventCount, 0);
    const sources = ascent.families.reduce((count, family) => count + family.metrics.ascent.recordedEventCount, 0);
    const display = sources > 0 ? resolveUnitAwareDisplayFromValue(DataAscent.type, ascent.totalAscentMeters, unitSettings) : null;
    const complete = events.status === 'ready' && events.complete && sources === eligible;
    recordedMetrics.splice(2, 0, { label: 'Ascent', text: display?.text ?? 'Unavailable', coverage: display && !complete
      ? `From ${number.format(sources)} of ${number.format(eligible)} activities that count toward ascent` : '' });
  }
  const workouts = new Map<string, ScheduledWorkoutV1>();
  if (schedule.status === 'ready' && schedule.data) for (const workout of schedule.data.workouts) {
    if (workout.lifecycle !== 'deleted' && (workout.planId === null || workout.planId === schedule.data.state.activePlanId)
      && workout.localDate >= input.startLocalDate && workout.localDate <= input.endLocalDate) workouts.set(workout.id, workout);
  }
  if (schedule.status === 'error') planningWarnings.push('Planned workouts could not be loaded. Try again to see your plan.');
  else if (schedule.status === 'ready' && !schedule.complete) planningWarnings.push('Some planned workouts may be missing. Totals include only the workouts loaded so far.');
  const coverage = resolveCalendarCompletionCoverage([...workouts.values()], completions);
  const linkedIds = new Set(coverage.linkedWorkoutIds);
  const completedCount = linkedIds.size;
  let skippedCount = 0;
  // No activity links are needed to establish that a fully loaded period has no workouts.
  const emptySchedule = schedule.status === 'ready' && schedule.complete && workouts.size === 0;
  const completionComplete = emptySchedule || coverage.complete;
  const { changedSinceCompletionCount } = coverage;
  const remainingWorkouts: ScheduledWorkoutV1[] = [];
  for (const workout of workouts.values()) {
    if (linkedIds.has(workout.id)) continue;
    if (workout.lifecycle === 'skipped') skippedCount++;
    else remainingWorkouts.push(workout);
  }
  if (!completionComplete && schedule.status === 'ready' && completions.status !== 'loading') planningWarnings.push(
    'Workout activity matches could not be checked. Remaining workouts are unavailable for now.');
  if (changedSinceCompletionCount > 0) planningWarnings.push('Some workouts were edited after their activity was recorded. Your activity may reflect the earlier version.');
  const analyze = (values: ScheduledWorkoutV1[]): WorkoutAnalysisAggregateV1 | null => {
    try { return aggregateWorkoutAnalysesV1(values.map(value => analyzeWorkoutStructureV1(value.structure)), { sourceComplete: schedule.complete }); }
    catch { planningWarnings.push('Some workout totals could not be calculated. You can still open each workout to see its steps.'); return null; }
  };
  const scheduleReady = schedule.status === 'ready' && !!schedule.data;
  // Skipped prescriptions contribute no planned volume, even if retained completion evidence exists.
  const plannedWorkouts = [...workouts.values()].filter(workout => workout.lifecycle === 'planned');
  const planned = scheduleReady ? analyze(plannedWorkouts) : null;
  const remaining = scheduleReady && completionComplete ? analyze(remainingWorkouts) : null;
  return {
    period: input.period ?? 'week',
    periodKey: `${input.period ?? 'week'}:${input.startLocalDate}:${input.endLocalDate}`,
    recordedStatus: events.status, completionStatus: completions.status,
    recordedCount: events.status === 'ready' ? recorded.size : null,
    recordedComplete: events.status === 'ready' && events.complete,
    scheduleComplete: scheduleReady && schedule.complete,
    recordedMetrics, scheduledCount: scheduleReady ? workouts.size : null,
    completedCount: scheduleReady && completionComplete ? completedCount : null,
    skippedCount: scheduleReady && completionComplete ? skippedCount : null,
    remainingCount: scheduleReady && completionComplete ? remainingWorkouts.length : null,
    changedSinceCompletionCount, planned, remaining,
    plannedText: formatCalendarWorkoutTotals(planned, unitSettings), remainingText: formatCalendarWorkoutTotals(remaining, unitSettings),
    warnings: [...recordedWarnings, ...planningWarnings],
    loading: events.status === 'loading' || schedule.status === 'loading' || (!emptySchedule && completions.status === 'loading'),
  };
}
