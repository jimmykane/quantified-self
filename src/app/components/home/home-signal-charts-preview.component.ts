import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  QueryList,
  ViewChildren,
  computed,
  effect,
  inject,
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import {
  buildDashboardFormPointsFromDailyLoads,
  type DashboardFormPoint,
} from '../../helpers/dashboard-form.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { AppChartsModule } from '../../modules/app-charts.module';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import {
  buildHomeSignalChartPalette,
  buildHomeSignalChartPreviews,
} from './home-signal-charts-preview.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  selector: 'app-home-signal-charts-preview',
  templateUrl: './home-signal-charts-preview.component.html',
  styleUrls: ['./home-signal-charts-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [AppChartsModule],
})
export class HomeSignalChartsPreviewComponent implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);

  readonly previews = buildHomeSignalChartPreviews(buildHomeSignalChartPalette(false));
  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly animationsEnabled = isPlatformBrowser(this.platformId)
    && (typeof window.matchMedia !== 'function'
      || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  readonly formTimeline = buildFormTimeline();
  readonly latestFormPoint = [...this.formTimeline]
    .reverse()
    .find(point => point.trainingStressScore > 0) || this.formTimeline.at(-1) || null;

  @ViewChildren('chartDiv') private chartDivs!: QueryList<ElementRef<HTMLDivElement>>;

  private readonly chartHosts: EChartsHostController[];
  private viewInitialized = false;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHosts = this.previews.map(preview => new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: `[HomeSignalChartsPreview:${preview.key}]`,
      enableMobileTapFeedback: false,
    }));

    effect(() => {
      const darkTheme = this.themeService.appTheme() === AppThemes.Dark;
      if (!this.viewInitialized) {
        return;
      }
      this.chartHosts.forEach(host => host.dispose());
      void this.renderCharts(darkTheme);
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.viewInitialized = true;
    void this.renderCharts(this.themeService.appTheme() === AppThemes.Dark);
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.chartHosts.forEach(host => host.dispose());
  }

  private async renderCharts(darkTheme: boolean): Promise<void> {
    const chartElements = this.chartDivs?.toArray() || [];
    const previews = buildHomeSignalChartPreviews(buildHomeSignalChartPalette(darkTheme));

    await Promise.all(chartElements.map(async (chartElement, index) => {
      const host = this.chartHosts[index];
      const preview = previews[index];
      if (!host || !preview) {
        return;
      }
      const chart = await host.init(
        chartElement.nativeElement,
        resolveEChartsThemeName(darkTheme),
      );
      if (!chart) {
        return;
      }
      host.setOption(preview.option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
      host.scheduleResize();
    }));
  }
}
