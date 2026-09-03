import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TrainingMetricGridComponent } from './training-metric-grid.component';
import { TrainingSummaryCardsComponent } from './training-summary-cards.component';
import type { TrainingSummaryCard, TrainingSummaryMetric } from './training-summary.models';

@Component({
  selector: 'app-training-snapshot-preview',
  standalone: true,
  imports: [TrainingSummaryCardsComponent, TrainingMetricGridComponent],
  templateUrl: './training-snapshot-preview.component.html',
  styleUrls: ['./training-snapshot-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingSnapshotPreviewComponent {
  readonly cards: readonly TrainingSummaryCard[] = [
    {
      id: 'state',
      label: 'State',
      valueText: 'Balanced',
      captionText: 'TSS-only load model',
      kind: 'state',
    },
    {
      id: 'readiness',
      label: 'Readiness today',
      valueText: '78',
      qualifierText: 'Ready',
      captionText: 'Load + recorded sleep signals',
      indicator: {
        label: 'Readiness',
        value: 78,
        tone: 'ready',
        showThresholds: true,
      },
    },
    {
      id: 'training-time',
      label: 'Training time',
      valueText: '18h 42m',
      captionText: '+12% versus usual 28 days',
      indicator: {
        label: 'Training time versus usual',
        value: 12,
        variant: 'deviation',
        compact: true,
      },
    },
    {
      id: 'workouts',
      label: 'Workouts',
      valueText: '14',
      captionText: '2 more than usual',
      indicator: {
        label: 'Workouts versus usual',
        value: 17,
        variant: 'deviation',
        compact: true,
      },
    },
  ];

  readonly loadMetrics: readonly TrainingSummaryMetric[] = [
    { id: 'fitness', label: 'Fitness (CTL)', valueText: '62', detailText: '42-day load' },
    { id: 'fatigue', label: 'Fatigue (ATL)', valueText: '54', detailText: '7-day load' },
    { id: 'form-now', label: 'Form now', valueText: '+8', detailText: 'Fitness − fatigue' },
    { id: 'ramp', label: 'Ramp', valueText: '+1.4', detailText: '7-day fitness change' },
    { id: 'acwr', label: 'ACWR', valueText: '1.03', detailText: 'Acute ÷ chronic load' },
    { id: 'monotony', label: 'Monotony', valueText: '1.42', detailText: 'Weekly load variability' },
    { id: 'strain', label: 'Strain', valueText: '684', detailText: 'Load × monotony' },
    { id: 'form-plus-seven', label: 'Form +7 days', valueText: '+15', detailText: 'No-additional-load scenario' },
  ];

  readonly contextMetrics: readonly TrainingSummaryMetric[] = [
    { id: 'recovery-debt', label: 'Recovery debt', valueText: '2 days', detailText: 'Estimated to neutral Form' },
    { id: 'recovery-left', label: 'Recovery left', valueText: '8h 20m', detailText: 'Imported estimate' },
    { id: 'intensity-balance', label: 'Intensity balance', valueText: '72% easy · 14% hard', detailText: 'Latest eligible week' },
    { id: 'efficiency', label: 'Efficiency', valueText: '+3.2%', detailText: 'Versus previous 4 weeks' },
  ];
}
