import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
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
  readonly counts = computed(() => [
    { label: 'Scheduled', value: this.summary().scheduledCount },
    { label: 'Completed links', value: this.summary().completedCount },
    { label: 'Skipped, unlinked', value: this.summary().skippedCount },
    { label: 'Remaining, unlinked', value: this.summary().remainingCount },
  ].map(count => ({ ...count, label: count.value !== null && !this.summary().scheduleComplete ? `Observed ${count.label.toLowerCase()}` : count.label })));
}
