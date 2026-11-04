import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { HistoryImportProgressItem } from '../../helpers/history-import-progress.helper';

/** The same read-only progress details in notifications and provider management. */
@Component({selector: 'app-history-import-summary', standalone: true,
  imports: [DecimalPipe, MatIconModule, MatProgressBarModule],
  templateUrl: './history-import-summary.component.html', styleUrl: './history-import-summary.component.scss'})
export class HistoryImportSummaryComponent {
  readonly item = input.required<HistoryImportProgressItem>();
}
