import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
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
import type { TrainingReadinessTrendPointViewModel } from '../../helpers/training-readiness.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface TrendTooltipParam {
  dataIndex?: number;
}

@Component({
  selector: 'app-training-readiness-trend-chart',
  templateUrl: './training-readiness-trend-chart.component.html',
  styleUrls: ['./training-readiness-trend-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingReadinessTrendChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() points: readonly TrainingReadinessTrendPointViewModel[] = [];
  @Input() ariaLabel = 'Readiness scores over 14 days.';
  @Input() darkTheme = false;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private viewInitialized = false;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: '[TrainingReadinessTrendChartComponent]',
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewInitialized && (changes.points || changes.darkTheme)) {
      void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.chartHost.dispose();
  }

  private async refresh(): Promise<void> {
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
    this.chartHost.setOption(this.buildOption(), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildOption(): ChartOption {
    if (!this.points.length) {
      return { animation: false, tooltip: { show: false }, xAxis: [], yAxis: [], series: [] };
    }

    const style = buildDashboardEChartsStyleTokens(
      this.darkTheme,
      this.chartDiv?.nativeElement.clientWidth || 0,
    );
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const pointsByIndex = this.points;
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: style.textColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: {
        left: 4,
        right: 8,
        top: 8,
        bottom: 6,
        outerBoundsMode: 'same',
        outerBoundsContain: 'axisLabel',
      },
      tooltip: {
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: TrendTooltipParam | TrendTooltipParam[]) => {
          const entries = Array.isArray(params) ? params : [params];
          const dataIndex = entries.find(entry => Number.isInteger(entry?.dataIndex))?.dataIndex;
          const point = Number.isInteger(dataIndex) ? pointsByIndex[dataIndex as number] : null;
          if (!point) {
            return '';
          }
          if (point.score === null) {
            return renderDashboardEChartsTooltipCard(style, {
              title: dateFormatter.format(new Date(point.dayMs)),
              rows: [{ label: 'Readiness', value: 'No score' }],
              notes: ['Not enough evidence was available.'],
            });
          }
          const baselineText = point.baselineEvidenceCount > 0
            ? `${point.baselineEvidenceCount} ${point.baselineEvidenceCount === 1 ? 'night' : 'nights'}`
            : 'No nights';
          return renderDashboardEChartsTooltipCard(style, {
            title: dateFormatter.format(new Date(point.dayMs)),
            rows: [
              { label: 'Readiness', value: `${formatScore(point.score)}/100`, markerColor: style.trendLineColor },
              { label: 'Status', value: point.statusLabel || 'Unavailable' },
              { label: 'Confidence', value: capitalize(point.confidence || 'Unavailable') },
              { label: 'Signals', value: `${point.availableSignalCount}/4` },
              { label: 'Baseline', value: baselineText },
            ],
          });
        },
      },
      xAxis: {
        type: 'time',
        min: this.points[0].dayMs,
        max: this.points[this.points.length - 1].dayMs,
        boundaryGap: false,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { show: false },
        axisLabel: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          formatter: (value: number) => `${Math.round(value)}`,
        },
      },
      series: [{
        name: 'Readiness',
        type: 'line',
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        data: this.points.map(point => [point.dayMs, point.score]),
        lineStyle: { width: 2.25, color: style.trendLineColor },
        itemStyle: { color: style.trendLineColor },
        emphasis: { scale: 1.3 },
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          label: { show: false },
          data: [{
            yAxis: 75,
            lineStyle: { color: style.trendLineColor, type: 'dashed', opacity: 0.65 },
          }, {
            yAxis: 55,
            lineStyle: { color: style.trendLineColor, type: 'dashed', opacity: 0.65 },
          }],
        },
      }],
    };
  }
}

function formatScore(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}
