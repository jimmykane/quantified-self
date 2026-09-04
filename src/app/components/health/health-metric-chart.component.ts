import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { formatHealthUnit, HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';
import { buildHealthChartModels, HealthChartSeriesModel } from '../../helpers/health-metric-chart.helper';
import { HealthMetricSeriesChartComponent } from './health-metric-series-chart.component';

@Component({
  selector: 'app-health-metric-chart',
  standalone: true,
  imports: [MatCardModule, MatChipsModule, HealthMetricSeriesChartComponent],
  templateUrl: './health-metric-chart.component.html',
  styleUrls: ['./health-metric-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthMetricChartComponent {
  readonly series = input.required<readonly HealthWorkspaceSeries[]>();
  readonly startTimeMs = input.required<number>();
  readonly endTimeMs = input.required<number>();
  readonly darkTheme = input(false);
  readonly models = computed(() => buildHealthChartModels(this.series(), this.startTimeMs(), this.endTimeMs()));

  formatSeriesUnit(model: HealthChartSeriesModel): string {
    const latest = model.displayedPoints.at(-1);
    return latest
      ? formatHealthUnit(model.series.metricId, latest.value, model.series.unit, model.series.nativeOnly)
      : '';
  }
}
