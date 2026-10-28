import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { SharedModule } from '../../../modules/shared.module';
import type { CalendarPeriodSummary } from '../../../helpers/calendar-period-summary.helper';

@Component({
  selector: 'app-calendar-period-summary', standalone: true, imports: [SharedModule],
  templateUrl: './calendar-period-summary.component.html', styleUrl: './calendar-period-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPeriodSummaryComponent {
  readonly summary = input.required<CalendarPeriodSummary>();
  readonly periodLabel = computed(() => this.summary().period === 'month' ? 'Month' : 'Week');
  readonly canRetry = input(false);
  readonly retryRequested = output<void>();
  readonly showPlanning = computed(() => (this.summary().scheduledCount ?? 0) > 0);
  // Source refreshes keep the user's choice; moving to another period closes the details.
  readonly expanded = linkedSignal({ source: () => this.summary().periodKey,
    computation: (periodKey, previous) => previous?.source === periodKey ? previous.value : false });
  readonly recordedText = computed(() => {
    const summary = this.summary();
    if (summary.recordedStatus === 'loading') return 'Loading activities…';
    if (summary.recordedCount === null) return 'Activities unavailable';
    if (summary.recordedCount === 0 && summary.recordedComplete) return `No activities this ${summary.period}`;
    const count = summary.recordedCount.toLocaleString();
    return `${count} ${summary.recordedCount === 1 ? 'activity' : 'activities'}${summary.recordedComplete ? '' : ' loaded so far'}`;
  });
  readonly counts = computed(() => [
    { label: 'With an activity', value: this.summary().completedCount },
    { label: 'Skipped', value: this.summary().skippedCount },
    { label: 'Remaining', value: this.summary().remainingCount },
  ].filter(count => count.value === null || count.value > 0));
}
