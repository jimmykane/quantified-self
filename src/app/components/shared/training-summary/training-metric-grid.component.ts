import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { segmentTrainingMetricText } from '../../../helpers/training-metric-text.helper';
import type { TrainingSummaryMetric } from './training-summary.models';
import { MetricHistoryChartComponent } from '../metric-history-chart/metric-history-chart.component';
import { normalizeMetricHistoryPoints } from '../../../helpers/metric-history-chart.helper';

@Component({
  selector: 'app-training-metric-grid',
  standalone: true,
  imports: [MetricHistoryChartComponent],
  templateUrl: './training-metric-grid.component.html',
  styleUrl: './training-metric-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingMetricGridComponent {
  readonly metrics = input<readonly TrainingSummaryMetric[]>([]);
  readonly mode = input<'workspace' | 'preview-load' | 'preview-context'>('workspace');
  readonly ariaLabel = input('Training metrics');
  readonly darkTheme = input(false);

  protected readonly presentedMetrics = computed(() => this.metrics().map(metric => ({
    ...metric,
    valueSegments: segmentTrainingMetricText(metric.valueText),
    history: metric.history && normalizeMetricHistoryPoints(metric.history.points).length ? metric.history : undefined,
  })));
}
