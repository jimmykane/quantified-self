import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import {
  buildDashboardFormPointsFromDailyLoads,
  type DashboardFormPoint,
} from '../../helpers/dashboard-form.helper';
import {
  type DashboardEfficiencyTrendContext,
  type DashboardFreshnessForecastContext,
  type DashboardIntensityDistributionContext,
} from '../../helpers/dashboard-derived-metrics.helper';
import type { DashboardPowerCurveContext } from '../../helpers/dashboard-power-curve.helper';
import { AppChartsModule } from '../../modules/app-charts.module';
import { AppThemeService } from '../../services/app.theme.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function getPreviewDayMs(): number {
  const today = new Date();
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
}

function buildFormTimeline(previewDayMs: number): DashboardFormPoint[] {
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

function buildFreshnessForecast(previewDayMs: number): DashboardFreshnessForecastContext {
  const actualCtl = [54, 55, 56, 57, 58, 59, 59];
  const actualAtl = [68, 66, 65, 67, 64, 62, 61];
  const actualTss = [90, 55, 0, 104, 42, 0, 58];
  const forecastCtl = [58, 57, 56, 55, 54, 53, 52];
  const forecastAtl = [53, 46, 40, 35, 31, 27, 24];
  const points = [
    ...actualCtl.map((ctl, index) => ({
      dayMs: previewDayMs - ((actualCtl.length - 1 - index) * DAY_MS),
      trainingStressScore: actualTss[index],
      ctl,
      atl: actualAtl[index],
      formSameDay: ctl - actualAtl[index],
      formPriorDay: index === 0 ? null : actualCtl[index - 1] - actualAtl[index - 1],
      isForecast: false,
    })),
    ...forecastCtl.map((ctl, index) => ({
      dayMs: previewDayMs + ((index + 1) * DAY_MS),
      trainingStressScore: 0,
      ctl,
      atl: forecastAtl[index],
      formSameDay: ctl - forecastAtl[index],
      formPriorDay: index === 0
        ? actualCtl.at(-1)! - actualAtl.at(-1)!
        : forecastCtl[index - 1] - forecastAtl[index - 1],
      isForecast: true,
    })),
  ];

  return { generatedAtMs: previewDayMs, points };
}

function buildIntensityDistribution(previewDayMs: number): DashboardIntensityDistributionContext {
  const easyPercent = [82, 78, 85, 74, 88, 86, 84, 87];
  const moderatePercent = [15, 18, 12, 23, 10, 12, 14, 11];
  const hardPercent = [3, 4, 3, 3, 2, 2, 2, 2];
  const weeks = easyPercent.map((easy, index) => ({
    weekStartMs: previewDayMs - ((easyPercent.length - 1 - index) * WEEK_MS),
    easySeconds: easy * 600,
    moderateSeconds: moderatePercent[index] * 600,
    hardSeconds: hardPercent[index] * 600,
    source: 'power' as const,
  }));

  return {
    weeks,
    latestWeekStartMs: weeks.at(-1)?.weekStartMs ?? null,
    latestEasyPercent: easyPercent.at(-1) ?? null,
    latestModeratePercent: moderatePercent.at(-1) ?? null,
    latestHardPercent: hardPercent.at(-1) ?? null,
  };
}

function buildEfficiencyTrend(previewDayMs: number): DashboardEfficiencyTrendContext {
  const values = [1.82, 1.85, 1.83, 1.88, 1.91, 1.94, 1.92, 1.96];
  const points = values.map((value, index) => ({
    weekStartMs: previewDayMs - ((values.length - 1 - index) * WEEK_MS),
    value,
    sampleCount: 3 + (index % 3),
    totalDurationSeconds: 9_000 + (index * 420),
  }));

  return {
    points,
    latestWeekStartMs: points.at(-1)?.weekStartMs ?? null,
    latestValue: values.at(-1) ?? null,
  };
}

function buildPowerCurve(previewDayMs: number): DashboardPowerCurveContext {
  const durations = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
  const bestPower = [910, 690, 560, 430, 370, 318, 282, 248, 232, 205];
  const latestPower = [865, 650, 525, 405, 345, 295, 266, 232, 218, 192];
  const latestEventStartMs = previewDayMs - (2 * DAY_MS);

  return {
    matchedEventCount: 18,
    sourceEventCount: 20,
    latestEventId: 'homepage-preview-latest',
    latestEventStartMs,
    latestSeriesLabel: 'Latest cycling activity',
    compareMode: 'latest',
    comparisonSeriesLabel: 'Latest cycling activity',
    comparisonEventCount: 1,
    series: [
      {
        seriesKey: 'best',
        label: 'Best in range',
        colorKey: 'best',
        points: durations.map((duration, index) => ({ duration, power: bestPower[index] })),
      },
      {
        seriesKey: 'latest',
        label: 'Latest cycling activity',
        colorKey: 'latest',
        eventId: 'homepage-preview-latest',
        eventStartMs: latestEventStartMs,
        points: durations.map((duration, index) => ({ duration, power: latestPower[index] })),
      },
    ],
    summaryPoints: [60, 300, 1200].map(duration => {
      const index = durations.indexOf(duration);
      return { duration, power: bestPower[index] };
    }),
  };
}

@Component({
  selector: 'app-home-signal-charts-preview',
  templateUrl: './home-signal-charts-preview.component.html',
  styleUrls: ['./home-signal-charts-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AppChartsModule],
})
export class HomeSignalChartsPreviewComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);
  private readonly previewDayMs = getPreviewDayMs();

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly animationsEnabled = isPlatformBrowser(this.platformId)
    && (typeof window.matchMedia !== 'function'
      || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  readonly freshnessForecast = buildFreshnessForecast(this.previewDayMs);
  readonly intensityDistribution = buildIntensityDistribution(this.previewDayMs);
  readonly efficiencyTrend = buildEfficiencyTrend(this.previewDayMs);
  readonly powerCurve = buildPowerCurve(this.previewDayMs);
  readonly formTimeline = buildFormTimeline(this.previewDayMs);
  readonly latestFormPoint = [...this.formTimeline]
    .reverse()
    .find(point => point.trainingStressScore > 0) || this.formTimeline.at(-1) || null;
}
