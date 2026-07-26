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
import { DataWeight, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
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
import type { TrainingBodyWeightTrendPointViewModel } from '../../helpers/training-body-weight.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface TrendTooltipParam {
  dataIndex?: number;
}

@Component({
  selector: 'app-training-body-weight-trend-chart',
  templateUrl: './training-body-weight-trend-chart.component.html',
  styleUrls: ['./training-body-weight-trend-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingBodyWeightTrendChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() points: readonly TrainingBodyWeightTrendPointViewModel[] = [];
  @Input() ariaLabel = 'Body-weight trend over 28 days.';
  @Input() darkTheme = false;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private viewInitialized = false;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: '[TrainingBodyWeightTrendChartComponent]',
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewInitialized && (changes.points || changes.darkTheme || changes.unitSettings)) {
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
    const unit = this.formatWeight(1).unit;
    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: style.textColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: {
        left: 4,
        right: 10,
        top: 14,
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
          return renderDashboardEChartsTooltipCard(style, {
            title: dateFormatter.format(new Date(point.dayMs)),
            rows: [{
              label: 'Body weight',
              value: point.weightKg === null ? 'No measurement' : this.formatWeight(point.weightKg).text,
              markerColor: point.weightKg === null ? null : style.trendLineColor,
            }],
            notes: point.weightKg === null ? ['Missing measurements remain chart gaps.'] : [],
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
        name: unit,
        nameTextStyle: { color: style.secondaryTextColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
        axisLine: { show: false },
        axisTick: { show: false },
        splitNumber: 3,
        splitLine: { lineStyle: { color: style.gridColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          formatter: (value: number) => this.formatWeight(value).value,
        },
      },
      series: [{
        name: 'Body weight',
        type: 'line',
        connectNulls: false,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        data: this.points.map(point => [point.dayMs, point.weightKg]),
        lineStyle: { width: 2.25, color: style.trendLineColor },
        itemStyle: { color: style.trendLineColor },
        emphasis: { scale: 1.3 },
      }],
    };
  }

  private formatWeight(value: number): { text: string; value: string; unit: string } {
    const display = resolveUnitAwareDisplayStat(new DataWeight(value), this.unitSettings);
    return display || {
      text: `${formatNumber(value)} kg`,
      value: formatNumber(value),
      unit: 'kg',
    };
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}
