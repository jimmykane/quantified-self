import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
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

@Component({
  selector: 'app-health-metric-chart',
  standalone: true,
  imports: [CompactRowComponent, MatChipsModule, HealthMetricSeriesChartComponent],
  templateUrl: './health-metric-chart.component.html',
  styleUrls: ['./health-metric-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthMetricChartComponent {
  readonly series = input.required<readonly HealthWorkspaceSeries[]>();
  readonly startTimeMs = input.required<number>();
  readonly endTimeMs = input.required<number>();
  readonly darkTheme = input(false);
  readonly timelineNotes = input<TimelineNoteChartContext | null>(null);
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  readonly chartStatuses = input<Readonly<Record<string, HealthHrvPersonalRangeStatus>>>({});
  readonly models = computed(() => buildHealthChartModels(
    this.series(),
    this.startTimeMs(),
    this.endTimeMs(),
    this.unitSettings(),
  ));
  readonly renderedModels = computed(() => this.models().map(model => {
    const status = this.chartStatuses()[model.series.id] || null;
    return {
      model,
      statusOverlay: buildHealthHrvChartStatusOverlay(status),
      statusDescription: healthHrvChartStatusDescription(status),
    };
  }));
}
