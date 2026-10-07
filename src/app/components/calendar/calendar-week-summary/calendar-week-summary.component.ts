import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SharedModule } from '../../../modules/shared.module';
import type { CalendarWeekSummary } from '../../../helpers/calendar-week-summary.helper';

@Component({
  selector: 'app-calendar-week-summary', standalone: true, imports: [SharedModule],
  templateUrl: './calendar-week-summary.component.html', styleUrl: './calendar-week-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarWeekSummaryComponent {
  readonly summary = input.required<CalendarWeekSummary>();
  readonly canRetry = input(false);
  readonly retryRequested = output<void>();
  readonly counts = computed(() => [
    { label: 'Scheduled', value: this.summary().scheduledCount },
    { label: 'Completed links', value: this.summary().completedCount },
    { label: 'Skipped, unlinked', value: this.summary().skippedCount },
    { label: 'Remaining, unlinked', value: this.summary().remainingCount },
  ].map(count => ({ ...count, label: count.value !== null && !this.summary().scheduleComplete ? `Observed ${count.label.toLowerCase()}` : count.label })));
}
