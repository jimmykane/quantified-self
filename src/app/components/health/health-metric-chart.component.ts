import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';
import { HEALTH_CHART_VIEWBOX, buildHealthChartModels } from '../../helpers/health-metric-chart.helper';

@Component({
  selector: 'app-health-metric-chart',
  standalone: true,
  templateUrl: './health-metric-chart.component.html',
  styleUrls: ['./health-metric-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthMetricChartComponent {
  readonly series = input.required<readonly HealthWorkspaceSeries[]>();
  readonly startTimeMs = input.required<number>();
  readonly endTimeMs = input.required<number>();
  readonly viewBox = `0 0 ${HEALTH_CHART_VIEWBOX.width} ${HEALTH_CHART_VIEWBOX.height}`;
  readonly models = computed(() => buildHealthChartModels(this.series(), this.startTimeMs(), this.endTimeMs()));
}
