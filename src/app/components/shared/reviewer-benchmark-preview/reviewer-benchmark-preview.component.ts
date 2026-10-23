import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AppThemes, ChartCursorBehaviours, XAxisTypes } from '@sports-alliance/sports-lib';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../../helpers/echarts-tooltip-interaction.helper';
import { SharedModule } from '../../../modules/shared.module';
import { AppThemeService } from '../../../services/app.theme.service';
import { CompactRowComponent } from '../compact-row/compact-row.component';
import { EChartsHostController, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS } from '../../../helpers/echarts-host-controller';
import { resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { buildReviewerRRChartOption, buildReviewerRRMetricRows } from './reviewer-benchmark-rr-preview.data';
import {
  REVIEWER_BENCHMARK_ALTITUDE_PANEL,
  REVIEWER_BENCHMARK_DURATION_SECONDS,
  REVIEWER_BENCHMARK_HEART_RATE_PANEL,
} from './reviewer-benchmark-chart-preview.data';

@Component({
  selector: 'app-reviewer-benchmark-preview',
  standalone: true,
  imports: [MatIconModule, CompactRowComponent, SharedModule],
  templateUrl: './reviewer-benchmark-preview.component.html',
  styleUrls: ['./reviewer-benchmark-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewerBenchmarkPreviewComponent {
  private readonly themeService = inject(AppThemeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly logger = inject(LoggerService);
  private readonly rrContainer = viewChild<ElementRef<HTMLElement>>('rrChart');
  private readonly rrHost = new EChartsHostController({
    eChartsLoader: inject(EChartsLoaderService), logger: this.logger,
    deferUntilNearViewport: true, enableMobileTapFeedback: false, logPrefix: '[ReviewerBenchmarkRR]',
    onContainerResize: () => this.refreshRRChart(),
  });
  private rrRenderVersion = 0;

  readonly darkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);
  readonly heartRatePanel = REVIEWER_BENCHMARK_HEART_RATE_PANEL;
  readonly altitudePanel = REVIEWER_BENCHMARK_ALTITUDE_PANEL;
  readonly xAxisType = XAxisTypes.Duration;
  readonly xDomain = { start: 0, end: REVIEWER_BENCHMARK_DURATION_SECONDS };
  readonly cursorBehaviour = ChartCursorBehaviours.ZoomX;
  readonly mobileTapFeedbackOptions = DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS;
  readonly rrMetricRows = buildReviewerRRMetricRows();
  readonly rrChartUnavailable = signal(false);

  constructor() {
    effect(() => this.refreshRRChart());
    this.destroyRef.onDestroy(() => { this.rrRenderVersion++; this.rrHost.dispose(); });
  }

  private refreshRRChart(): void {
    const container = this.rrContainer()?.nativeElement;
    const darkTheme = this.darkTheme();
    if (!container || this.destroyRef.destroyed) return;
    void this.renderRRChart(container, darkTheme);
  }

  private async renderRRChart(container: HTMLElement, darkTheme: boolean): Promise<void> {
    const version = ++this.rrRenderVersion;
    try {
      const chart = await this.rrHost.init(container, resolveEChartsThemeName(darkTheme));
      if (this.destroyRef.destroyed || version !== this.rrRenderVersion) return;
      if (!chart) { this.rrChartUnavailable.set(true); return; }
      this.rrHost.setOption(buildReviewerRRChartOption(darkTheme, container.clientWidth), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
      this.rrChartUnavailable.set(false);
    } catch (error) {
      if (this.destroyRef.destroyed || version !== this.rrRenderVersion) return;
      this.rrHost.dispose(); this.rrChartUnavailable.set(true);
      this.logger.warn('[ReviewerBenchmarkRR] Chart preview unavailable', error);
    }
  }
}
