import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AppThemes } from '@sports-alliance/sports-lib';
import type {
  DashboardEasyPercentContext,
  DashboardFitnessCtlContext,
  DashboardFormNowContext,
} from '../../helpers/dashboard-derived-metrics.helper';
import {
  buildDashboardFormPointsFromDailyLoads,
  type DashboardFormPoint,
} from '../../helpers/dashboard-form.helper';
import {
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
} from '../../helpers/dashboard-special-chart-types';
import { AppChartsModule } from '../../modules/app-charts.module';
import { AppThemeService } from '../../services/app.theme.service';
import { resolveMapClusterPaintTokens } from '../../services/map/map-cluster-style.helper';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_WEEK_MS = Date.UTC(2026, 7, 24);

function buildTrend(values: number[]): Array<{ time: number; value: number }> {
  return values.map((value, index) => ({
    time: PREVIEW_WEEK_MS - ((values.length - 1 - index) * WEEK_MS),
    value,
  }));
}

function buildFormTimeline(): DashboardFormPoint[] {
  const today = new Date();
  const previewDayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const weeklyLoadPattern = [0, 76, 52, 94, 0, 128, 58];
  const dayCount = 16 * 7;

  return buildDashboardFormPointsFromDailyLoads(
    Array.from({ length: dayCount }, (_, index) => {
      const progression = 0.84 + ((index / (dayCount - 1)) * 0.18);
      const trainingStressScore = weeklyLoadPattern[index % weeklyLoadPattern.length];
      return {
        dayMs: previewDayMs - ((dayCount - 1 - index) * DAY_MS),
        load: Math.round(trainingStressScore * progression),
      };
    }),
  );
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
  readonly clusterPaint = computed(() => resolveMapClusterPaintTokens(this.themeService.appTheme()));
  readonly fitnessChartType = DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE;
  readonly formChartType = DASHBOARD_FORM_NOW_KPI_CHART_TYPE;
  readonly easyChartType = DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE;
  readonly formTimeline = buildFormTimeline();
  readonly latestFormPoint = [...this.formTimeline]
    .reverse()
    .find(point => point.trainingStressScore > 0) || this.formTimeline.at(-1) || null;

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
