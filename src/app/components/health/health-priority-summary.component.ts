import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  HealthPriorityRow,
  HealthHrvPersonalRangeStatus,
  HealthWorkspaceMetricSelection,
  HealthWorkspaceSeries,
  formatHealthValue,
  isSleepHrvSemanticVariant,
} from '../../helpers/health-workspace.helper';
import {
  HealthChartSeriesModel,
  HealthChartStatusOverlay,
  buildHealthChartModels,
  buildHealthHrvChartStatusOverlay,
  healthHrvChartStatusDescription,
  healthHrvPersonalRangeToneColor,
} from '../../helpers/health-metric-chart.helper';
import { HealthMetricSeriesChartComponent } from './health-metric-series-chart.component';
import { HealthSleepStageSummaryComponent } from './health-sleep-stage-summary.component';
import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import type { AppHealthHighlightId, AppHealthHighlightSources } from '../../models/app-user.interface';

interface HealthPrioritySourceView {
  key: string;
  label: string;
  valueText: string;
  chart?: HealthPriorityChartView;
  row?: HealthPriorityRow;
}

export interface HealthHighlightSourceSelection {
  cardId: AppHealthHighlightId;
  sourceKey: string;
}

interface HealthPriorityChartView {
  model: HealthChartSeriesModel;
  latestValueText: string;
  contextText: string;
  personalRangeStatus: HealthHrvPersonalRangeStatus | null;
  statusColor: string | null;
  statusOverlay: HealthChartStatusOverlay | null;
  statusDescription: string | null;
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
  sources: readonly HealthPrioritySourceView[];
  selectedSourceIndex: number;
}

export interface HealthPriorityCardView {
  id: AppHealthHighlightId;
  label: string;
  icon: string;
  metric: HealthWorkspaceMetricSelection;
  rows: readonly HealthPriorityRow[];
  chartSeries: readonly HealthWorkspaceSeries[];
  chartStatuses?: Readonly<Record<string, HealthHrvPersonalRangeStatus>>;
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
    MatTabsModule,
    NgTemplateOutlet,
    CompactRowComponent,
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
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly preferredSources = input<AppHealthHighlightSources>({});
  readonly metricSelected = output<HealthWorkspaceMetricSelection>();
  readonly sourceSelected = output<HealthHighlightSourceSelection>();
  readonly renderedCards = computed<readonly RenderedHealthPriorityCardView[]>(() => this.cards().map(card => {
    const startTimeMs = card.chartWindow?.startTimeMs ?? this.startTimeMs();
    const endTimeMs = card.chartWindow?.endTimeMs ?? this.endTimeMs();
    const chartModels = buildHealthChartModels(
      card.chartSeries,
      startTimeMs,
      endTimeMs,
      this.unitSettings(),
    ).map(model => {
      const latestPoint = model.series.points.at(-1);
      const personalRangeStatus = card.chartStatuses?.[model.series.id] || null;
      const statusColor = personalRangeStatus
        ? healthHrvPersonalRangeToneColor(personalRangeStatus.tone)
        : null;
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
        personalRangeStatus,
        statusColor,
        statusOverlay: buildHealthHrvChartStatusOverlay(personalRangeStatus),
        statusDescription: healthHrvChartStatusDescription(personalRangeStatus),
        startTimeMs,
        endTimeMs,
      };
    });
    const sources: HealthPrioritySourceView[] = chartModels.length
      ? chartModels.map(chart => ({
        key: chart.model.series.sourceSelectionKey || chart.model.series.id,
        label: chart.model.series.sourceLabel,
        valueText: chart.latestValueText,
        chart,
      }))
      : card.rows.map(row => ({
        key: row.sourceSelectionKey || row.id,
        label: row.sourceLabel,
        valueText: row.valueText,
        row,
      }));
    return {
      ...card,
      chartModels,
      sources,
      selectedSourceIndex: Math.max(0, sources.findIndex(source => source.key === this.preferredSources()[card.id])),
    };
  }));

  selectSource(cardId: AppHealthHighlightId, index: number): void {
    const card = this.renderedCards().find(item => item.id === cardId);
    const source = card?.sources[index];
    // Material also emits on initialization and programmatic hydration. Only
    // a different, available selection represents a user action.
    if (!card || !source || card.loading || card.error || index === card.selectedSourceIndex) return;
    this.sourceSelected.emit({ cardId, sourceKey: source.key });
  }
}
