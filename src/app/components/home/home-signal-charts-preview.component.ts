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
  effect,
  inject,
} from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import {
  buildHomeSignalChartPreviews,
  type HomeSignalChartPalette,
} from './home-signal-charts-preview.helper';

const DEFAULT_PALETTE: HomeSignalChartPalette = {
  primary: '#526ba7',
  secondary: '#6d6e73',
  tertiary: '#4e7b68',
  error: '#ba1a1a',
};

@Component({
  selector: 'app-home-signal-charts-preview',
  templateUrl: './home-signal-charts-preview.component.html',
  styleUrls: ['./home-signal-charts-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
})
export class HomeSignalChartsPreviewComponent implements AfterViewInit, OnDestroy {
  readonly previews = buildHomeSignalChartPreviews(DEFAULT_PALETTE);

  @ViewChildren('chartDiv') private chartDivs!: QueryList<ElementRef<HTMLDivElement>>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly themeService = inject(AppThemeService);
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
    const palette = this.resolvePalette(chartElements[0]?.nativeElement);
    const previews = buildHomeSignalChartPreviews(palette);

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

  private resolvePalette(element?: HTMLElement): HomeSignalChartPalette {
    if (!element || typeof getComputedStyle !== 'function') {
      return DEFAULT_PALETTE;
    }
    const styles = getComputedStyle(element);
    const color = (token: string, fallback: string): string => (
      styles.getPropertyValue(token).trim() || fallback
    );
    return {
      primary: color('--mat-sys-primary', DEFAULT_PALETTE.primary),
      secondary: color('--mat-sys-secondary', DEFAULT_PALETTE.secondary),
      tertiary: color('--mat-sys-tertiary', DEFAULT_PALETTE.tertiary),
      error: color('--mat-sys-error', DEFAULT_PALETTE.error),
    };
  }
}
