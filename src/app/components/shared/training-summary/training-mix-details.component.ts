import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TrainingProfileMetricId, TrainingSportContextId } from '@shared/training-disciplines';
import type { TrainingCardGuidanceViewModel } from '../../../helpers/training-card-guidance.helper';
import { TrainingMetricTextComponent } from '../../training/training-metric-text.component';

export interface TrainingContextMetricViewModel {
  metric: TrainingProfileMetricId;
  label: string;
  currentText: string;
  referenceText: string;
}

export interface TrainingContextMetricsViewModel {
  context: TrainingSportContextId;
  label: string;
  metrics: TrainingContextMetricViewModel[];
}

export interface TrainingMixZoneViewModel {
  label: 'Easy' | 'Moderate' | 'Hard';
  currentText: string;
  baselineText: string;
  currentPercent: number | null;
  baselinePercent: number | null;
}

export interface TrainingMixDetailsViewModel {
  label: string;
  activityCountText: string;
  baselineActivityCountText: string;
  durationText: string;
  baselineDurationText: string;
  zones: TrainingMixZoneViewModel[];
  intensityEvidenceText: string | null;
  contexts: TrainingContextMetricsViewModel[];
  guidance: TrainingCardGuidanceViewModel;
}
@Component({
  selector: 'app-training-mix-details', standalone: true,
  imports: [TrainingMetricTextComponent],
  templateUrl: './training-mix-details.component.html',
  styleUrl: './training-mix-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingMixDetailsComponent {
  readonly view = input.required<TrainingMixDetailsViewModel>();
  readonly single = input(true);
}
