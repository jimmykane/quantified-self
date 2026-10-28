import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { segmentTrainingMetricText } from '../../../helpers/training-metric-text.helper';
import { MetricIndicatorComponent } from '../metric-indicator/metric-indicator.component';
import type { TrainingSummaryCard } from './training-summary.models';

@Component({
  selector: 'app-training-summary-cards',
  standalone: true,
  imports: [MetricIndicatorComponent],
  templateUrl: './training-summary-cards.component.html',
  styleUrl: './training-summary-cards.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingSummaryCardsComponent {
  readonly cards = input<readonly TrainingSummaryCard[]>([]);
  readonly mode = input<'workspace' | 'preview'>('workspace');
  readonly ariaLabel = input('Current Training overview');
  /** Optional presentation context; never changes the state or comparison metrics. */
  readonly stateCaptionOverride = input<string | null>(null);

  protected readonly presentedCards = computed(() => this.cards().map(card => ({
    ...card,
    captionText: card.kind === 'state' ? (this.stateCaptionOverride() ?? card.captionText) : card.captionText,
    valueSegments: segmentTrainingMetricText(card.valueText),
  })));
}
