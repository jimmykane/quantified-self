import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TrainingMetricGridComponent } from './training-metric-grid.component';
import { TrainingSummaryCardsComponent } from './training-summary-cards.component';
import type { TrainingSummaryCard, TrainingSummaryMetric } from './training-summary.models';
import { RenderedThemeService } from '../../../services/rendered-theme.service';
import { getNumberFormatter } from '../../../helpers/number-format.helper';
import type { MetricHistory, MetricHistoryPoint } from '../../../helpers/metric-history-chart.helper';
import { extendDashboardFormPointsWithZeroLoadUntil, type DashboardFormPoint } from '../../../helpers/dashboard-form.helper';
import { buildCurrentTrainingStateContext } from '../../../helpers/current-training-state.helper';

const EXAMPLE_DAY_MS = Date.UTC(2026, 8, 21);
const WEEK_MS = 7 * 86400000;
// Synthetic weekly load observations, shared by the histories and forecast seed.
const EXAMPLE_WEEKLY_LOAD = [[48, 58], [50, 63], [53, 49], [52, 65], [56, 71], [58, 55], [60.6, 64], [62, 54]] as const;
const EXAMPLE_FORM_POINTS: readonly DashboardFormPoint[] = EXAMPLE_WEEKLY_LOAD.map(([ctl, atl], index) => ({
  time: EXAMPLE_DAY_MS + (index - EXAMPLE_WEEKLY_LOAD.length + 1) * WEEK_MS,
  ctl, atl, formSameDay: ctl - atl, formPriorDay: null, trainingStressScore: 0, activityCount: 0,
}));
const EXAMPLE_CURRENT_STATE = buildCurrentTrainingStateContext({
  formPoints: EXAMPLE_FORM_POINTS, fallbackFormNow: null, fallbackRampRate: null, nowMs: EXAMPLE_DAY_MS,
});

function formatExampleValue(value: number | null, digits: number, signed: boolean): string {
  if (value === null) return '--';
  return `${signed && value > 0 ? '+' : ''}${getNumberFormatter(undefined, { maximumFractionDigits: digits }).format(value)}`;
}

function exampleWeeklyPoints(values: readonly number[]): MetricHistoryPoint[] {
  return values.map((value, index) => ({ time: EXAMPLE_DAY_MS + (index - values.length + 1) * WEEK_MS, value }));
}

function exampleHistory(points: readonly MetricHistoryPoint[], digits = 0, signed = false): MetricHistory {
  return {
    caption: '8-week history',
    mode: 'columns',
    points: points.map(point => ({ ...point, valueText: formatExampleValue(point.value, digits, signed) })),
  };
}

function exampleForecast(): MetricHistory {
  const points = extendDashboardFormPointsWithZeroLoadUntil([EXAMPLE_FORM_POINTS.at(-1)!], EXAMPLE_DAY_MS + WEEK_MS);
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
    { id: 'fitness', label: 'Fitness (CTL)', valueText: formatExampleValue(EXAMPLE_CURRENT_STATE.fitness?.value ?? null, 0, false), detailText: '42-day load', history: exampleHistory(EXAMPLE_CURRENT_STATE.fitness?.trend8Weeks || []) },
    { id: 'fatigue', label: 'Fatigue (ATL)', valueText: formatExampleValue(EXAMPLE_CURRENT_STATE.fatigue?.value ?? null, 0, false), detailText: '7-day load', history: exampleHistory(EXAMPLE_CURRENT_STATE.fatigue?.trend8Weeks || []) },
    { id: 'form-now', label: 'Form now', valueText: formatExampleValue(EXAMPLE_CURRENT_STATE.formNow?.value ?? null, 0, true), detailText: 'Fitness − fatigue', history: exampleHistory(EXAMPLE_CURRENT_STATE.formNow?.trend8Weeks || [], 0, true) },
    { id: 'ramp', label: 'Ramp', valueText: formatExampleValue(EXAMPLE_CURRENT_STATE.rampRate?.rampRate ?? null, 1, true), detailText: '7-day fitness change', history: exampleHistory(EXAMPLE_CURRENT_STATE.rampRate?.trend8Weeks || [], 1, true) },
    { id: 'acwr', label: 'ACWR', valueText: '1.03', detailText: 'Acute ÷ chronic load', history: exampleHistory(exampleWeeklyPoints([1.1, 1.2, .9, 1.2, 1.3, 1, 1.15, 1.03]), 2) },
    { id: 'monotony', label: 'Monotony', valueText: '1.42', detailText: 'Weekly load variability' },
    { id: 'strain', label: 'Strain', valueText: '684', detailText: 'Load × monotony', history: exampleHistory(exampleWeeklyPoints([410, 480, 520, 460, 590, 720, 640, 684])) },
    { id: 'form-plus-seven', label: 'Form +7 days', valueText: this.forecastHistory.points.at(-1)!.valueText, detailText: 'No-additional-load scenario', history: this.forecastHistory },
  ];

  readonly contextMetrics: readonly TrainingSummaryMetric[] = [
    { id: 'recovery-debt', label: 'Recovery debt', valueText: '2 days', detailText: 'Estimated to neutral Form' },
    { id: 'recovery-left', label: 'Recovery left', valueText: '8h 20m', detailText: 'Imported estimate' },
    { id: 'intensity-balance', label: 'Intensity balance', valueText: '72% easy · 14% hard', detailText: 'Latest eligible week' },
    { id: 'efficiency', label: 'Efficiency', valueText: '+3.2%', detailText: 'Versus previous 4 weeks' },
  ];
}
