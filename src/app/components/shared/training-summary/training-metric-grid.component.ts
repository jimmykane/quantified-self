import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { segmentTrainingMetricText } from '../../../helpers/training-metric-text.helper';
import type { TrainingSummaryMetric } from './training-summary.models';

@Component({
  selector: 'app-training-metric-grid',
  standalone: true,
  templateUrl: './training-metric-grid.component.html',
  styleUrl: './training-metric-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingMetricGridComponent {
  readonly metrics = input<readonly TrainingSummaryMetric[]>([]);
  readonly mode = input<'workspace' | 'preview-load' | 'preview-context'>('workspace');
  readonly ariaLabel = input('Training metrics');

  protected readonly presentedMetrics = computed(() => this.metrics().map(metric => ({
    ...metric,
    valueSegments: segmentTrainingMetricText(metric.valueText),
  })));
}
