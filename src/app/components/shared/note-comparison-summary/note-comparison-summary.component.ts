import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ChartSourceChoice } from '../../../helpers/chart-source.helper';
import type { NoteComparisonMetric, NoteComparisonRow } from '../../../helpers/timeline-note-comparison.helper';
import { ChartSourcePickerComponent } from '../chart-source-picker/chart-source-picker.component';
import { SummaryDisclosureComponent } from '../summary-disclosure/summary-disclosure.component';

export interface NoteComparisonSummaryRow extends Omit<NoteComparisonRow, 'choices'> {
  choices: readonly ChartSourceChoice[];
  beforeText: string;
  afterText: string;
  differenceText: string;
}

/** Render already-calculated comparisons; never classify a numerical change as recovery or improvement. */
@Component({
  selector: 'app-note-comparison-summary', standalone: true,
  imports: [ChartSourcePickerComponent, SummaryDisclosureComponent],
  templateUrl: './note-comparison-summary.component.html', styleUrl: './note-comparison-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteComparisonSummaryComponent {
  readonly rows = input.required<readonly NoteComparisonSummaryRow[]>();
  readonly days = input.required<number>();
  readonly summaryId = input.required<string>();
  readonly scopeKey = input.required<string>();
  readonly headingLevel = input<2 | 3 | 4>(2);
  readonly state = input<'ready' | 'updating' | 'failed'>('ready');
  readonly disabled = input(false);
  readonly sourceSelected = output<{ metric: NoteComparisonMetric; key: string }>();
  readonly headline = computed(() => this.state() === 'updating' ? 'Updating comparison · Differences withheld'
    : this.state() === 'failed' ? 'Refresh failed · Differences withheld'
    : `${this.rows().filter(row => row.difference !== null).length} of ${this.rows().length} metrics comparable · ${this.days()} days on each side`);
  readonly viewRows = computed(() => this.rows().map(row => ({ ...row,
    sourceText: row.choices.find(choice => choice.key === row.selectedKey)?.label
      || (row.selectedKey ? 'Selected source unavailable' : 'No eligible recorded source'),
  })));
}
