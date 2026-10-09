import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TrainingMetricGridComponent } from './training-metric-grid.component';
import { TrainingSummaryCardsComponent } from './training-summary-cards.component';
import type { TrainingSummaryCard, TrainingSummaryMetric } from './training-summary.models';
import { RenderedThemeService } from '../../../services/rendered-theme.service';
import { getNumberFormatter } from '../../../helpers/number-format.helper';
import type { MetricHistory } from '../../../helpers/metric-history-chart.helper';
import { extendDashboardFormPointsWithZeroLoadUntil } from '../../../helpers/dashboard-form.helper';

const EXAMPLE_DAY_MS = Date.UTC(2026, 8, 21);

function formatExampleValue(value: number, digits: number, signed: boolean): string {
  return `${signed && value > 0 ? '+' : ''}${getNumberFormatter(undefined, { maximumFractionDigits: digits }).format(value)}`;
}

function exampleHistory(values: number[], digits = 0, signed = false): MetricHistory {
  return {
    caption: '8-week history',
    mode: 'columns',
    points: values.map((value, index) => ({
      time: EXAMPLE_DAY_MS + (index - 7) * 7 * 86400000,
      value,
      valueText: formatExampleValue(value, digits, signed),
    })),
  };
}

function exampleForecast(): MetricHistory {
  const points = extendDashboardFormPointsWithZeroLoadUntil([{
    time: EXAMPLE_DAY_MS, ctl: 62, atl: 54, formSameDay: 8, formPriorDay: null,
    trainingStressScore: 0, activityCount: 0,
  }], EXAMPLE_DAY_MS + 7 * 86400000);
  return {
    caption: 'Next 7 days', mode: 'forecast',
    points: points.map(point => ({ time: point.time, value: point.formSameDay, valueText: formatExampleValue(point.formSameDay, 0, true) })),
  };
}

@Component({
  selector: 'app-training-snapshot-preview',
  standalone: true,
  imports: [TrainingSummaryCardsComponent, TrainingMetricGridComponent],
  templateUrl: './training-snapshot-preview.component.html',
  styleUrls: ['./training-snapshot-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingSnapshotPreviewComponent {
  readonly darkTheme = inject(RenderedThemeService).darkTheme;
  private readonly forecastHistory = exampleForecast();
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
    { id: 'fitness', label: 'Fitness (CTL)', valueText: '62', detailText: '42-day load', history: exampleHistory([48, 50, 53, 52, 56, 58, 60, 62]) },
    { id: 'fatigue', label: 'Fatigue (ATL)', valueText: '54', detailText: '7-day load', history: exampleHistory([58, 63, 49, 65, 71, 55, 64, 54]) },
    { id: 'form-now', label: 'Form now', valueText: '+8', detailText: 'Fitness − fatigue', history: exampleHistory([-10, -13, 4, -13, -15, 3, -4, 8], 0, true) },
    { id: 'ramp', label: 'Ramp', valueText: '+1.4', detailText: '7-day fitness change', history: exampleHistory([2.1, 2, 3, -1, 4, 2, 2, 1.4], 1, true) },
    { id: 'acwr', label: 'ACWR', valueText: '1.03', detailText: 'Acute ÷ chronic load', history: exampleHistory([1.1, 1.2, .9, 1.2, 1.3, 1, 1.15, 1.03], 2) },
    { id: 'monotony', label: 'Monotony', valueText: '1.42', detailText: 'Weekly load variability' },
    { id: 'strain', label: 'Strain', valueText: '684', detailText: 'Load × monotony', history: exampleHistory([410, 480, 520, 460, 590, 720, 640, 684]) },
    { id: 'form-plus-seven', label: 'Form +7 days', valueText: this.forecastHistory.points.at(-1)!.valueText, detailText: 'No-additional-load scenario', history: this.forecastHistory },
  ];

  readonly contextMetrics: readonly TrainingSummaryMetric[] = [
    { id: 'recovery-debt', label: 'Recovery debt', valueText: '2 days', detailText: 'Estimated to neutral Form' },
    { id: 'recovery-left', label: 'Recovery left', valueText: '8h 20m', detailText: 'Imported estimate' },
    { id: 'intensity-balance', label: 'Intensity balance', valueText: '72% easy · 14% hard', detailText: 'Latest eligible week' },
    { id: 'efficiency', label: 'Efficiency', valueText: '+3.2%', detailText: 'Versus previous 4 weeks' },
  ];
}
