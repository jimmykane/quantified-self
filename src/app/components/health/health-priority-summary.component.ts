import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  HealthPriorityRow,
  HealthWorkspaceMetricSelection,
  HealthWorkspaceSeries,
  buildHealthPriorityTrendComparison,
  formatHealthValue,
  isSleepHrvSemanticVariant,
} from '../../helpers/health-workspace.helper';
import { HealthChartSeriesModel, buildHealthChartModels } from '../../helpers/health-metric-chart.helper';
import { HealthMetricSeriesChartComponent } from './health-metric-series-chart.component';
import { HealthSleepStageSummaryComponent } from './health-sleep-stage-summary.component';

interface HealthPriorityChartView {
  model: HealthChartSeriesModel;
  latestValueText: string;
  contextText: string;
  comparisonText: string | null;
  startTimeMs: number;
  endTimeMs: number;
}

export interface HealthPriorityChartWindow {
  startTimeMs: number;
  endTimeMs: number;
  label: string;
}

interface RenderedHealthPriorityCardView extends HealthPriorityCardView {
  chartModels: readonly HealthPriorityChartView[];
}

export interface HealthPriorityCardView {
  id: 'sleep' | 'heart_rate' | 'heart_rate_variability';
  label: string;
  icon: string;
  metric: HealthWorkspaceMetricSelection;
  rows: readonly HealthPriorityRow[];
  chartSeries: readonly HealthWorkspaceSeries[];
  chartWindow?: HealthPriorityChartWindow;
  available: boolean;
  loading: boolean;
  error: boolean;
  emptyText: string;
}

@Component({
  selector: 'app-health-priority-summary',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    HealthMetricSeriesChartComponent,
    HealthSleepStageSummaryComponent,
  ],
  templateUrl: './health-priority-summary.component.html',
  styleUrls: ['./health-priority-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthPrioritySummaryComponent {
  readonly cards = input.required<readonly HealthPriorityCardView[]>();
  readonly startTimeMs = input.required<number>();
  readonly endTimeMs = input.required<number>();
  readonly darkTheme = input(false);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly metricSelected = output<HealthWorkspaceMetricSelection>();
  readonly renderedCards = computed<readonly RenderedHealthPriorityCardView[]>(() => this.cards().map(card => {
    const startTimeMs = card.chartWindow?.startTimeMs ?? this.startTimeMs();
    const endTimeMs = card.chartWindow?.endTimeMs ?? this.endTimeMs();
    return {
      ...card,
      chartModels: buildHealthChartModels(
        card.chartSeries,
        startTimeMs,
        endTimeMs,
        this.unitSettings(),
      ).map(model => {
        const latestPoint = model.series.points.at(-1);
        return {
          model,
          latestValueText: latestPoint
            ? formatHealthValue(
              model.series.metricId,
              latestPoint.value,
              model.series.unit,
              model.series.nativeOnly,
              this.unitSettings(),
            )
            : '—',
          contextText: card.chartWindow
            ? `${isSleepHrvSemanticVariant(model.series.semanticVariant) ? 'Sleep HRV' : card.label} · ${card.chartWindow.label}`
            : model.series.semanticLabel,
          comparisonText: card.id === 'heart_rate_variability'
            ? buildHealthPriorityTrendComparison(model.series, this.unitSettings())
            : null,
          startTimeMs,
          endTimeMs,
        };
      }),
    };
  }));
}
