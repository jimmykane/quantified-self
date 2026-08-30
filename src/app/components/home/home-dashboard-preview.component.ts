import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AppThemes } from '@sports-alliance/sports-lib';
import type {
  DashboardEasyPercentContext,
  DashboardFitnessCtlContext,
  DashboardFormNowContext,
} from '../../helpers/dashboard-derived-metrics.helper';
import {
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
} from '../../helpers/dashboard-special-chart-types';
import { AppChartsModule } from '../../modules/app-charts.module';
import { AppThemeService } from '../../services/app.theme.service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_WEEK_MS = Date.UTC(2026, 7, 24);

function buildTrend(values: number[]): Array<{ time: number; value: number }> {
  return values.map((value, index) => ({
    time: PREVIEW_WEEK_MS - ((values.length - 1 - index) * WEEK_MS),
    value,
  }));
}

@Component({
  selector: 'app-home-dashboard-preview',
  templateUrl: './home-dashboard-preview.component.html',
  styleUrls: ['./home-dashboard-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AppChartsModule, MatIconModule],
})
export class HomeDashboardPreviewComponent {
  private readonly themeService = inject(AppThemeService);

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly fitnessChartType = DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE;
  readonly formChartType = DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
  readonly easyChartType = DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE;

  readonly fitnessCtl: DashboardFitnessCtlContext = {
    latestDayMs: PREVIEW_WEEK_MS,
    value: 62,
    trend8Weeks: buildTrend([49, 51, 52, 55, 57, 58, 60, 62]),
  };

  readonly formNow: DashboardFormNowContext = {
    latestDayMs: PREVIEW_WEEK_MS,
    value: 8,
    trend8Weeks: buildTrend([-7, -3, 2, -5, 1, 4, 6, 8]),
  };

  readonly easyPercent: DashboardEasyPercentContext = {
    latestWeekStartMs: PREVIEW_WEEK_MS,
    value: 72,
    trend8Weeks: buildTrend([63, 65, 66, 68, 67, 70, 71, 72]),
  };
}
