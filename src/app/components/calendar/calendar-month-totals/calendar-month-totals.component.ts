import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { WorkoutAnalysisAggregateV1 } from '@shared/planned-workout-analysis';
import { SharedModule } from '../../../modules/shared.module';
import { formatActivityCalendarDuration, type ActivityCalendarSummaryMetric } from '../../../helpers/activity-calendar.helper';
import type { CalendarPeriodSummary } from '../../../helpers/calendar-period-summary.helper';

@Component({
  selector: 'app-calendar-month-totals', standalone: true, imports: [SharedModule],
  templateUrl: './calendar-month-totals.component.html', styleUrl: './calendar-month-totals.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarMonthTotalsComponent {
  readonly summary = input.required<CalendarPeriodSummary>();
  readonly activityMetrics = input.required<ActivityCalendarSummaryMetric[]>();
  readonly periodLabel = input.required<string>();
  readonly activityStatus = input<'loading' | 'ready' | 'error'>('ready');
  readonly activitiesComplete = input(true);
  readonly hasWorkouts = computed(() => (this.summary().scheduledCount ?? 0) > 0);
  readonly activityDescription = computed(() => {
    if (this.activityStatus() === 'loading') return 'Loading activities…';
    if (this.activityStatus() === 'error') return 'Activities unavailable';
    return this.activitiesComplete() ? `${this.periodLabel()} activity totals` : 'Some activities may be missing';
  });
  readonly workoutMetrics = computed(() => [
    { label: 'Workouts', value: this.formatCount(this.summary().scheduledCount) },
    { label: 'With activity', value: this.formatCount(this.summary().completedCount) },
    { label: 'Remaining', value: this.formatCount(this.summary().remainingCount) },
  ]);
  readonly caption = computed(() => {
    const summary = this.summary();
    if (summary.completedCount === null || summary.remainingCount === null) {
      return summary.completionStatus === 'loading' ? 'Checking activities…' : 'Activity matches unavailable';
    }
    if (!summary.scheduleComplete) return 'Some workouts may be missing';
    const planned = formatWorkoutTime(summary.planned);
    const remaining = formatWorkoutTime(summary.remaining);
    const parts: string[] = [];
    if (planned !== null) parts.push(`${planned} planned`);
    if (remaining !== null) parts.push(`${remaining} left`);
    if (summary.skippedCount !== null && summary.skippedCount > 0) parts.push(`${summary.skippedCount.toLocaleString()} skipped`);
    return parts.join(' · ');
  });
  readonly captionDetails = computed(() => {
    const summary = this.summary();
    const caption = this.caption();
    return [caption.endsWith('…') ? caption : `${caption}.`, `Planned: ${summary.plannedText}.`, `Remaining: ${summary.remainingText}.`,
      'Remaining workouts have no matching activity yet. This does not necessarily mean you missed them.',
      ...summary.warnings].join(' ');
  });

  private formatCount(count: number | null): string {
    if (count === null) return '—';
    return `${this.summary().scheduleComplete ? '' : '≥'}${count.toLocaleString()}`;
  }
}

function formatWorkoutTime(analysis: WorkoutAnalysisAggregateV1 | null): string | null {
  if (!analysis || !analysis.sourceComplete) return null;
  if (analysis.workoutCount === 0) return '0m';
  const range = analysis.summary.duration.completeRange;
  if (!range) return null;
  const maximum = formatActivityCalendarDuration(range.maximumSeconds);
  if (analysis.summary.earlyLapSteps > 0) return `Up to ${analysis.summary.duration.estimatedSteps > 0 ? 'about ' : ''}${maximum}`;
  const minimum = formatActivityCalendarDuration(range.minimumSeconds);
  const time = minimum === maximum ? minimum : `${minimum}–${maximum}`;
  return `${analysis.summary.duration.estimatedSteps > 0 ? 'About ' : ''}${time}`;
}
