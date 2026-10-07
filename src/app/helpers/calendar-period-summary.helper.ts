import { DataAscent, DataDistance, DataDuration, type EventInterface, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { aggregateWorkoutAnalysesV1, analyzeWorkoutStructureV1, type WorkoutAnalysisAggregateV1 } from '@shared/planned-workout-analysis';
import { formatWorkoutAnalysisSummaryV1 } from '@shared/planned-workout-analysis-display';
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
  const warnings: string[] = [];
  const number = new Intl.NumberFormat(locale);
  const recorded = new Map<string, EventInterface>();
  if (events.status === 'ready') for (const event of events.data) {
    const time = event.startDate?.getTime();
    if (time >= input.window.startMs && time < input.window.endExclusiveMs) recorded.set(event.getID(), event);
  }
  if (events.status === 'error') warnings.push('Recorded activities could not be loaded. Recorded totals are unavailable.');
  else if (events.status === 'ready' && !events.complete) warnings.push('Recorded coverage is incomplete. Values show only the observed activities.');
  const recordedMetrics = [
    { label: 'Duration', type: DataDuration.type },
    { label: 'Distance', type: DataDistance.type },
    { label: 'Recorded load', type: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE },
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
      ? `Subtotal · ${number.format(sources)} of ${number.format(recorded.size)} observed activities` : '' };
  });
  if (input.period === 'month') {
    const ascent = buildActivityCalendarPeriodSummary([...recorded.values()], input.summariesSettings);
    const eligible = ascent.families.reduce((count, family) => count + family.metrics.ascent.eligibleEventCount, 0);
    const sources = ascent.families.reduce((count, family) => count + family.metrics.ascent.recordedEventCount, 0);
    const display = sources > 0 ? resolveUnitAwareDisplayFromValue(DataAscent.type, ascent.totalAscentMeters, unitSettings) : null;
    const complete = events.status === 'ready' && events.complete && sources === eligible;
    recordedMetrics.splice(2, 0, { label: 'Ascent', text: display?.text ?? 'Unavailable', coverage: display && !complete
      ? `Subtotal · ${number.format(sources)} of ${number.format(eligible)} eligible observed activities` : '' });
  }
  const workouts = new Map<string, ScheduledWorkoutV1>();
  if (schedule.status === 'ready' && schedule.data) for (const workout of schedule.data.workouts) {
    if (workout.lifecycle !== 'deleted' && (workout.planId === null || workout.planId === schedule.data.state.activePlanId)
      && workout.localDate >= input.startLocalDate && workout.localDate <= input.endLocalDate) workouts.set(workout.id, workout);
  }
  if (schedule.status === 'error') warnings.push('Scheduled workouts could not be loaded. Prescription totals are unavailable.');
  else if (schedule.status === 'ready' && !schedule.complete) warnings.push('Schedule coverage is incomplete. Counts and prescriptions show only observed workouts.');
  const coverage = resolveCalendarCompletionCoverage([...workouts.values()], completions);
  const linkedIds = new Set(coverage.linkedWorkoutIds);
  const completedCount = linkedIds.size;
  let skippedCount = 0;
  const { complete: completionComplete, changedSinceCompletionCount } = coverage;
  const remainingWorkouts: ScheduledWorkoutV1[] = [];
  for (const workout of workouts.values()) {
    if (linkedIds.has(workout.id)) continue;
    if (workout.lifecycle === 'skipped') skippedCount++;
    else remainingWorkouts.push(workout);
  }
  if (!completionComplete && schedule.status === 'ready') warnings.push(completions.status === 'loading'
    ? 'Completion links are loading. Remaining prescriptions are unavailable.'
    : 'Completion coverage is unavailable. Remaining prescriptions and completion counts are unknown.');
  if (changedSinceCompletionCount > 0) warnings.push('Some linked workouts changed after completion. Links do not prove the current prescription was performed.');
  const analyze = (values: ScheduledWorkoutV1[]): WorkoutAnalysisAggregateV1 | null => {
    try { return aggregateWorkoutAnalysesV1(values.map(value => analyzeWorkoutStructureV1(value.structure)), { sourceComplete: schedule.complete }); }
    catch { warnings.push('Prescription totals are unavailable for an unrepresentable recipe.'); return null; }
  };
  const scheduleReady = schedule.status === 'ready' && !!schedule.data;
  // Skipped prescriptions contribute no planned volume, even if retained completion evidence exists.
  const plannedWorkouts = [...workouts.values()].filter(workout => workout.lifecycle === 'planned');
  const planned = scheduleReady ? analyze(plannedWorkouts) : null;
  const remaining = scheduleReady && completionComplete ? analyze(remainingWorkouts) : null;
  const analysisText = (analysis: WorkoutAnalysisAggregateV1 | null) => analysis === null ? 'Unavailable'
    : analysis.workoutCount === 0 ? analysis.sourceComplete ? 'No prescriptions' : 'No prescriptions in observed records; complete total unknown'
      : formatWorkoutAnalysisSummaryV1(analysis.summary, unitSettings, undefined, locale);
  return {
    period: input.period ?? 'week',
    recordedCount: events.status === 'ready' ? recorded.size : null,
    recordedComplete: events.status === 'ready' && events.complete,
    scheduleComplete: scheduleReady && schedule.complete,
    recordedMetrics, scheduledCount: scheduleReady ? workouts.size : null,
    completedCount: scheduleReady && completionComplete ? completedCount : null,
    skippedCount: scheduleReady && completionComplete ? skippedCount : null,
    remainingCount: scheduleReady && completionComplete ? remainingWorkouts.length : null,
    changedSinceCompletionCount, planned, remaining, plannedText: analysisText(planned), remainingText: analysisText(remaining), warnings,
    loading: events.status === 'loading' || schedule.status === 'loading' || completions.status === 'loading',
  };
}
