import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CompactRowComponent } from '../shared/compact-row/compact-row.component';
import { MatChipsModule } from '@angular/material/chips';
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
import { selectDefaultHealthSourceKey } from '../../helpers/health-source-selection.helper';
import { ChartSourcePickerComponent } from '../shared/chart-source-picker/chart-source-picker.component';

@Component({
  selector: 'app-health-metric-chart',
  standalone: true,
  imports: [CompactRowComponent, MatChipsModule, HealthMetricSeriesChartComponent, ChartSourcePickerComponent],
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
  readonly sourceSelected = output<string>();
  readonly models = computed(() => buildHealthChartModels(
    this.series(),
    this.startTimeMs(),
    this.endTimeMs(),
    this.unitSettings(),
  ));
  readonly heartRateChoices = computed(() => this.models().filter(model => model.series.metricId === HEALTH_METRIC_IDS.HeartRate)
    .map(model => healthChartSourceChoice(model.series)));
  readonly chosenKey = computed(() => this.selectedSourceKey() || selectDefaultHealthSourceKey(
    this.models().map(model => ({ ...model.series, key: model.series.id }))));
  readonly chosenReading = computed(() => this.heartRateChoices().find(choice => choice.key === this.chosenKey())?.readingKey);
  readonly visibleModels = computed(() => !this.heartRateChoices().length ? this.models()
    : this.models().filter(model => this.chosenReading() && heartRateReading(model.series)?.key === this.chosenReading())
      .sort((a, b) => Number(b.series.id === this.chosenKey()) - Number(a.series.id === this.chosenKey())));
  chooseSource(key: string): void {
    if (key !== this.chosenKey() && this.heartRateChoices().some(choice => choice.key === key)) this.sourceSelected.emit(key);
  }
  readonly renderedModels = computed(() => this.visibleModels().map(model => {
    const status = this.chartStatuses()[model.series.id] || null;
    const [, ...details] = model.series.semanticLabel.split(' · ');
    const describeHeartRate = model.series.metricId === HEALTH_METRIC_IDS.HeartRate && !model.series.nativeOnly;
    const choice = healthChartSourceChoice(model.series);
    return {
      model,
      title: describeHeartRate ? heartRateReading(model.series)?.label || model.readingLabel : model.series.sourceLabel,
      summary: describeHeartRate ? [model.series.sourceLabel, choice.readingMethod || details.join(' · ')].join(' · ') : model.readingLabel,
      statusOverlay: buildHealthHrvChartStatusOverlay(status),
      statusDescription: healthHrvChartStatusDescription(status),
    };
  }));
}
