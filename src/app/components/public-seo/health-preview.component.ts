import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AppThemes, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { buildHealthChartModels, buildHealthHrvChartStatusOverlay, healthHrvChartStatusDescription } from '../../helpers/health-metric-chart.helper';
import { buildHealthHrvPersonalRangeStatus } from '../../helpers/health-workspace.helper';
import { AppThemeService } from '../../services/app.theme.service';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { HealthSleepStageSummaryComponent } from '../health/health-sleep-stage-summary.component';
import { ChartsSleepTrendComponent } from '../charts/sleep-trend/charts.sleep-trend.component';
import { buildHealthPreviewSeries, buildHealthPreviewSleepTrend, HEALTH_PREVIEW_END, HEALTH_PREVIEW_START, type HealthPreviewKind } from './health-preview.data';

/** Public data adapter only: Health owns the charts, formatting and interaction. */
@Component({
  selector: 'app-health-preview', standalone: true,
  imports: [HealthMetricSeriesChartComponent, HealthSleepStageSummaryComponent, ChartsSleepTrendComponent],
  templateUrl: './health-preview.component.html',
  styleUrls: ['./health-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthPreviewComponent {
  readonly kind = input.required<HealthPreviewKind>();
  readonly unitSettings = input<UserUnitSettingsInterface | null>(null);
  private readonly theme = inject(AppThemeService);
  readonly darkTheme = computed(() => this.theme.appTheme() === AppThemes.Dark);
  readonly start = HEALTH_PREVIEW_START;
  readonly end = HEALTH_PREVIEW_END;
  readonly sleepTrend = buildHealthPreviewSleepTrend();
  readonly sleepPoint = this.sleepTrend.latestPoint!;
  readonly series = computed(() => buildHealthPreviewSeries(this.kind()));
  readonly model = computed(() => buildHealthChartModels([{
    ...this.series(),
    points: this.series().points.filter(point => point.timestampMs >= this.start && point.timestampMs <= this.end),
  }], this.start, this.end, this.unitSettings())[0]);
  readonly status = computed(() => this.kind() === 'hrv'
    ? buildHealthHrvPersonalRangeStatus(this.series(), this.end, this.unitSettings(), this.model().displayedPoints.map(point => point.timestampMs)) : null);
  readonly overlay = computed(() => buildHealthHrvChartStatusOverlay(this.status()));
  readonly statusDescription = computed(() => healthHrvChartStatusDescription(this.status()));
}
