import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  LOCALE_ID,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { EChartsType } from 'echarts/core';
import {
  buildDashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  renderDashboardEChartsTooltipCard,
} from '../../helpers/dashboard-echarts-style.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { getDateTimeFormatter } from '../../helpers/date-time-format.helper';
import { getNumberFormatter } from '../../helpers/number-format.helper';
import type { DashboardFormPoint } from '../../helpers/dashboard-form.helper';
import type { DashboardDerivedMetricStatus } from '../../helpers/derived-metric-status.helper';
import {
  buildTrainingImpactRecap,
  type TrainingImpactRecap,
  type TrainingImpactRecapBar,
  type TrainingImpactRecapPeriodDays,
} from '../../helpers/training-impact-recap.helper';
import { AppHapticsService } from '../../services/app.haptics.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface RecapTooltipParam {
  dataIndex?: number;
}

interface TrainingImpactRecapViewModel {
  headline: string;
  periodLabel: string;
  actualCtlChange: string;
  trainingCtlContribution: string;
  normalCtlDecay: string;
  totalTrainingStressScore: string;
  completedActivityCount: string;
  raisedDays: string;
  heldDays: string;
  declinedDays: string;
  chartAriaLabel: string;
}

@Component({
  selector: 'app-training-impact-recap',
  standalone: true,
  imports: [CommonModule, MatButtonToggleModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './training-impact-recap.component.html',
  styleUrls: ['./training-impact-recap.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrainingImpactRecapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() points: readonly DashboardFormPoint[] | null = null;
  @Input() formStatus: DashboardDerivedMetricStatus = 'missing';
  @Input() darkTheme = false;
  @Input() nowMs = Date.now();
  @ViewChild('chartDiv') set chartElement(element: ElementRef<HTMLDivElement> | undefined) {
    this.chartDiv = element;
    if (element && this.viewInitialized) {
      void this.refreshChart();
    }
  }
  public chartDiv?: ElementRef<HTMLDivElement>;

  public readonly periodDays = signal<TrainingImpactRecapPeriodDays>(7);
  public recap: TrainingImpactRecap | null = null;
  public viewModel: TrainingImpactRecapViewModel | null = null;
  public isUpdating = false;
  public hasFailedRefresh = false;
  public emptyState: 'history' | 'preparing' | 'unavailable' | null = 'preparing';

  private readonly haptics = inject(AppHapticsService);
  private readonly locale = inject(LOCALE_ID);
  private readonly eChartsLoader = inject(EChartsLoaderService);
  private readonly logger = inject(LoggerService);
  private readonly chartHost = new EChartsHostController({
    deferUntilNearViewport: true,
    eChartsLoader: this.eChartsLoader,
    logger: this.logger,
    logPrefix: '[TrainingImpactRecapComponent]',
    enableMobileTapFeedback: true,
  });
  private viewInitialized = false;

  public ngOnChanges(_changes: SimpleChanges): void {
    this.refreshModel();
  }

  public async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.refreshChart();
  }

  public ngOnDestroy(): void {
    this.viewInitialized = false;
    this.chartHost.dispose();
  }

  public selectPeriod(periodDays: TrainingImpactRecapPeriodDays): void {
    if (periodDays === this.periodDays()) {
      return;
    }
    this.periodDays.set(periodDays);
    this.haptics.selection();
    this.refreshModel();
  }

  private refreshModel(): void {
    this.recap = buildTrainingImpactRecap(this.points, this.periodDays(), this.nowMs);
    this.viewModel = this.recap ? this.buildViewModel(this.recap) : null;
    this.isUpdating = this.formStatus === 'building'
      || this.formStatus === 'stale'
      || this.formStatus === 'queued'
      || this.formStatus === 'processing';
    this.hasFailedRefresh = this.formStatus === 'failed' && !!this.recap;
    this.emptyState = this.recap
      ? null
      : this.formStatus === 'failed'
        ? 'unavailable'
        : this.formStatus === 'ready' && Array.isArray(this.points) && this.points.length === 0
          ? 'history'
          : 'preparing';
    if (this.viewInitialized) {
      void this.refreshChart();
    }
  }

  private buildViewModel(recap: TrainingImpactRecap): TrainingImpactRecapViewModel {
    const outcomeLabel = recap.outcome === 'raised'
      ? 'Fitness load rose'
      : recap.outcome === 'declined'
        ? 'Fitness load declined'
        : 'Fitness load held';
    return {
      headline: outcomeLabel,
      periodLabel: `${this.formatUtcDate(recap.startDayMs)} – ${this.formatUtcDate(recap.endDayMs)}`,
      actualCtlChange: this.formatSigned(recap.actualCtlChange),
      trainingCtlContribution: this.formatSigned(recap.trainingCtlContribution),
      normalCtlDecay: this.formatSigned(recap.normalCtlDecay),
      totalTrainingStressScore: this.formatNumber(recap.totalTrainingStressScore),
      completedActivityCount: this.formatInteger(recap.completedActivityCount),
      raisedDays: this.formatInteger(recap.outcomeCounts.raised),
      heldDays: this.formatInteger(recap.outcomeCounts.held),
      declinedDays: this.formatInteger(recap.outcomeCounts.declined),
      chartAriaLabel: `${recap.periodDays}-day Training impact chart. Actual fitness load changed ${this.formatSigned(recap.actualCtlChange)} CTL across completed UTC Training days. ${recap.bars.map(bar => `${this.formatBarLabel(bar, true)}: ${this.formatSigned(bar.ctlChange)} CTL`).join('; ')}.`,
    };
  }

  private async refreshChart(): Promise<void> {
    if (!this.chartDiv?.nativeElement) {
      return;
    }
    const chart = await this.chartHost.init(
      this.chartDiv.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }
    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildChartOption(), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildChartOption(): ChartOption {
    const recap = this.recap;
    if (!recap?.bars.length) {
      return { animation: false, tooltip: { show: false }, xAxis: [], yAxis: [], series: [] };
    }
    const style = buildDashboardEChartsStyleTokens(
      this.darkTheme,
      this.chartDiv?.nativeElement.clientWidth || 0,
    );
    const mobileTooltip = isEChartsMobileTooltipViewport();
    const positiveColor = style.trendLineColor;
    const negativeColor = style.errorColor;
    const bars = recap.bars;
    const hasNonZeroBar = bars.some(bar => Math.abs(bar.ctlChange) > Number.EPSILON);
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: style.textColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: { left: 8, right: 8, top: 14, bottom: 10, containLabel: true },
      tooltip: {
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, mobileTooltip),
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(mobileTooltip),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: RecapTooltipParam | RecapTooltipParam[]) => {
          const entries = Array.isArray(params) ? params : [params];
          const dataIndex = entries.find(entry => Number.isInteger(entry.dataIndex))?.dataIndex;
          const bar = Number.isInteger(dataIndex) ? bars[dataIndex as number] : null;
          if (!bar) {
            return '';
          }
          return renderDashboardEChartsTooltipCard(style, {
            title: this.formatBarLabel(bar, true),
            rows: [{
              label: 'Actual CTL change',
              value: this.formatSigned(bar.ctlChange),
              markerColor: bar.ctlChange < 0 ? negativeColor : positiveColor,
            }],
          });
        },
      },
      xAxis: {
        type: 'category',
        data: bars.map(bar => this.formatBarAxisLabel(bar, recap.periodDays)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          interval: recap.periodDays === 28 ? 0 : 'auto',
        },
      },
      yAxis: {
        type: 'value',
        min: hasNonZeroBar ? undefined : -1,
        max: hasNonZeroBar ? undefined : 1,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          formatter: (value: number) => this.formatNumber(value),
        },
      },
      series: [{
        name: 'Actual CTL change',
        type: 'bar',
        barMaxWidth: recap.periodDays === 7 ? 42 : 72,
        data: bars.map(bar => ({
          value: bar.ctlChange,
          itemStyle: {
            color: bar.ctlChange < 0 ? negativeColor : positiveColor,
            borderRadius: bar.ctlChange < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0],
          },
        })),
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          label: { show: false },
          data: [{ yAxis: 0, lineStyle: { color: style.axisColor, width: 1 } }],
        },
      }],
    };
  }

  private formatBarLabel(bar: TrainingImpactRecapBar, full: boolean): string {
    const options: Intl.DateTimeFormatOptions = full
      ? { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
      : { month: 'short', day: 'numeric', timeZone: 'UTC' };
    const start = getDateTimeFormatter(this.locale || undefined, options).format(new Date(bar.startDayMs));
    if (bar.startDayMs === bar.endDayMs) {
      return start;
    }
    const end = getDateTimeFormatter(this.locale || undefined, options).format(new Date(bar.endDayMs));
    return `${start} – ${end}`;
  }

  private formatBarAxisLabel(
    bar: TrainingImpactRecapBar,
    periodDays: TrainingImpactRecapPeriodDays,
  ): string {
    if (periodDays === 7 || bar.startDayMs === bar.endDayMs) {
      return this.formatBarLabel(bar, false);
    }
    const startDate = new Date(bar.startDayMs);
    const endDate = new Date(bar.endDayMs);
    const sameUtcMonth = startDate.getUTCFullYear() === endDate.getUTCFullYear()
      && startDate.getUTCMonth() === endDate.getUTCMonth();
    const start = getDateTimeFormatter(this.locale || undefined, sameUtcMonth
      ? { day: 'numeric', timeZone: 'UTC' }
      : { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(startDate);
    const end = getDateTimeFormatter(this.locale || undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(endDate);
    return `${start}–${end}`;
  }

  private formatUtcDate(dayMs: number): string {
    return getDateTimeFormatter(this.locale || undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(dayMs));
  }

  private formatSigned(value: number): string {
    return getNumberFormatter(this.locale || undefined, {
      maximumFractionDigits: 2,
      signDisplay: 'exceptZero',
    }).format(value);
  }

  private formatNumber(value: number): string {
    return getNumberFormatter(this.locale || undefined, {
      maximumFractionDigits: 2,
    }).format(value);
  }

  private formatInteger(value: number): string {
    return getNumberFormatter(this.locale || undefined, {
      maximumFractionDigits: 0,
    }).format(value);
  }
}
