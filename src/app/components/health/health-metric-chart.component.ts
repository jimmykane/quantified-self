import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppHapticsService } from '../../services/app.haptics.service';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  HealthHrvPersonalRangeStatus,
  HealthWorkspaceSeries,
} from '../../helpers/health-workspace.helper';
import {
  buildHealthChartModels,
  buildHealthHrvChartStatusOverlay,
  healthHrvChartStatusDescription,
} from '../../helpers/health-metric-chart.helper';
import { HealthMetricSeriesChartComponent } from './health-metric-series-chart.component';
import { HEALTH_METRIC_IDS } from '@shared/health';
import { healthChartSourceChoice, heartRateReading } from '../../helpers/chart-source.helper';
import { resolveHealthSourceKey } from '../../helpers/health-source-selection.helper';
import { ChartSourcePickerComponent } from '../shared/chart-source-picker/chart-source-picker.component';

@Component({
  selector: 'app-health-metric-chart',
  standalone: true,
  imports: [CompactRowComponent, MatChipsModule, MatButtonModule, MatIconModule, HealthMetricSeriesChartComponent, ChartSourcePickerComponent],
  templateUrl: './health-metric-chart.component.html',
  styleUrls: ['./health-metric-chart.component.scss'],
  host: { '[class.health-metric-chart-fill-height]': 'fillHeight()', '[class.health-metric-chart-has-picker]': 'heartRateChoices().length > 0' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthMetricChartComponent {
  readonly series = input.required<readonly HealthWorkspaceSeries[]>();
  readonly startTimeMs = input.required<number>();
  readonly endTimeMs = input.required<number>();
  readonly darkTheme = input(false);
  readonly fillHeight = input(false);
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly chartStatuses = input<Readonly<Record<string, HealthHrvPersonalRangeStatus>>>({});
  readonly selectedSourceKey = input<string | null>(null);
  readonly readingNotice = input<string | null>(null);
  readonly comparingSources = signal(false);
  readonly sourceSelected = output<string>();
  readonly expandedDetails = signal<ReadonlySet<string>>(new Set());
  private readonly haptics = inject(AppHapticsService);
  constructor() {
    effect(() => { this.series(); this.expandedDetails.set(new Set()); });
  }
  toggleDetails(id: string): void {
    if (!this.visibleModels().some(model => model.series.id === id)) return;
    this.expandedDetails.update(current => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    this.haptics.selection();
  }
  readonly models = computed(() => buildHealthChartModels(
    this.series(),
    this.startTimeMs(),
    this.endTimeMs(),
    this.unitSettings(),
  ));
  readonly heartRateChoices = computed(() => this.models().filter(model => model.series.metricId === HEALTH_METRIC_IDS.HeartRate)
    .map(model => healthChartSourceChoice(model.series)));
  readonly chosenKey = computed(() => resolveHealthSourceKey(
    this.models().map(model => ({ ...model.series, key: model.series.id })), this.selectedSourceKey()));
  readonly soleMeasurementLabel = computed(() => new Set(this.heartRateChoices().map(choice => choice.readingKey)).size === 1
    ? this.heartRateChoices().find(choice => choice.key === this.chosenKey())?.readingLabel || null : null);
  readonly chosenReading = computed(() => this.heartRateChoices().find(choice => choice.key === this.chosenKey())?.readingKey);
  readonly comparableModels = computed(() => !this.heartRateChoices().length ? this.models()
    : this.models().filter(model => this.chosenReading() && heartRateReading(model.series)?.key === this.chosenReading())
      .sort((a, b) => Number(b.series.id === this.chosenKey()) - Number(a.series.id === this.chosenKey())));
  readonly canCompareSources = computed(() => this.heartRateChoices().length > 0 && this.comparableModels().length > 1);
  readonly visibleModels = computed(() => this.heartRateChoices().length && !this.comparingSources()
    ? this.comparableModels().filter(model => model.series.id === this.chosenKey()) : this.comparableModels());
  toggleComparison(): void {
    if (!this.canCompareSources()) return;
    this.comparingSources.update(value => !value);
    this.haptics.selection();
  }
  chooseSource(key: string): void {
    if (key !== this.chosenKey() && this.heartRateChoices().some(choice => choice.key === key)) this.sourceSelected.emit(key);
  }
  readonly renderedModels = computed(() => this.visibleModels().map(model => {
    const status = this.chartStatuses()[model.series.id] || null;
    const describeHeartRate = model.series.metricId === HEALTH_METRIC_IDS.HeartRate && !model.series.nativeOnly;
    const choice = healthChartSourceChoice(model.series);
    const dailyAverage = !model.series.nativeOnly && ['qs_daily_sample_mean', 'qs_daily_interval_mean'].includes(model.series.semanticVariant);
    return {
      model,
      title: model.series.metricId === HEALTH_METRIC_IDS.HeartRate && !this.comparingSources()
        ? dailyAverage ? 'Latest daily average' : 'Latest reading' : model.series.sourceLabel,
      summary: describeHeartRate ? null : model.readingLabel,
      calculatedByQS: choice.readingMethod === 'Calculated by QS',
      readingCaption: dailyAverage && this.comparingSources() ? 'Daily average · Calculated by QS'
        : choice.readingMethod === 'Calculated by QS' ? 'Calculated by QS' : 'Latest reading',
      compactHeartRate: model.series.metricId === HEALTH_METRIC_IDS.HeartRate,
      recordingDescription: choice.readingDescription || choice.detail,
      statusOverlay: buildHealthHrvChartStatusOverlay(status),
      statusDescription: healthHrvChartStatusDescription(status),
    };
  }));
}
