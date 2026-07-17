import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { segmentTrainingMetricText } from '../../helpers/training-metric-text.helper';

@Component({
  selector: 'app-training-metric-text',
  templateUrl: './training-metric-text.component.html',
  styleUrls: ['./training-metric-text.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingMetricTextComponent {
  readonly text = input<string | null | undefined>('');
  readonly segments = computed(() => segmentTrainingMetricText(this.text()));
}
