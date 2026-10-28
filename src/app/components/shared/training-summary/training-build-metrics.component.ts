import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TrainingMetricTextComponent } from '../../training/training-metric-text.component';
export interface TrainingBuildMetricRowViewModel {
  label: string;
  currentText: string;
  benchmarkText: string;
  deltaText: string;
  deltaTone?: 'positive' | 'negative' | 'neutral';
  isIntensity: boolean;
}

@Component({
  selector: 'app-training-build-metrics', standalone: true,
  imports: [TrainingMetricTextComponent],
  templateUrl: './training-build-metrics.component.html',
  styleUrl: './training-build-metrics.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingBuildMetricsComponent {
  readonly rows = input<readonly TrainingBuildMetricRowViewModel[]>([]);
}
