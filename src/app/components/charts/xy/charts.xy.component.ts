import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import type { EChartsType } from 'echarts/core';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { AppColors } from '../../../services/color/app.colors';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../helpers/echarts-host-controller';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { buildDashboardEChartsStyleTokens } from '../../../helpers/dashboard-echarts-style.helper';
import { buildDashboardValueAxisConfig } from '../../../helpers/dashboard-echarts-yaxis.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import {
  formatDashboardDataDisplay,
  formatDashboardNumericValue,
  getDashboardAggregateData,
  getDashboardSummaryMetaLabel
} from '../../../helpers/dashboard-chart-data.helper';
import {
  buildDashboardCartesianPoints,
  buildDashboardDateRegressionLine,
  DashboardCartesianPoint
} from '../../../helpers/dashboard-echarts-cartesian.helper';
import { normalizeUnitDerivedTypeLabel } from '../../../helpers/stat-label.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type ChartSetOptionSettings = Parameters<EChartsType['setOption']>[1];

@Component({
  selector: 'app-xy-chart',
  templateUrl: './charts.xy.component.html',
  styleUrls: ['./charts.xy.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsXYComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() data: any;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() isLoading = false;
  @Input() vertical = true;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private readonly dateTypePalette = [
    AppColors.Blue,
    AppColors.Green,
    AppColors.Orange,
    AppColors.Purple,
    AppColors.LightBlue,
    AppColors.Yellow,
    AppColors.Pink,
    AppColors.Red,
    AppColors.DeepBlue,
    AppColors.LightGreen
  ];
  private static readonly EMPTY_DATA_UPDATE_SETTINGS: ChartSetOptionSettings = {
    notMerge: true,
    lazyUpdate: false
  };

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private eventColorService: AppEventColorService,
    private logger: LoggerService
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsXYComponent]'
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      return;
    }

    if (
      changes.data ||
      changes.darkTheme ||
      changes.useAnimations ||
      changes.chartDataType ||
      changes.chartDataValueType ||
      changes.chartDataCategoryType ||
      changes.chartDataTimeInterval ||
      changes.vertical
    ) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme)
    );
    if (!chart) {
      return;
    }

    const points = buildDashboardCartesianPoints({
      data: this.data,
      chartDataValueType: this.chartDataValueType,
      chartDataCategoryType: this.chartDataCategoryType,
      chartDataTimeInterval: this.chartDataTimeInterval
    });
    const aggregate = getDashboardAggregateData(
      Array.isArray(this.data) ? this.data : [],
      this.chartDataValueType,
      this.chartDataType,
      this.logger
    );
    const option = this.buildChartOption(points, aggregate);
    this.chartHost.hideTooltip();
    this.chartHost.setOption(
      option,
      points.length
        ? ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS
        : ChartsXYComponent.EMPTY_DATA_UPDATE_SETTINGS
    );
    this.chartHost.scheduleResize();
  }

  private buildChartOption(
    points: DashboardCartesianPoint[],
    aggregate: ReturnType<typeof getDashboardAggregateData>
  ): ChartOption {
    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const chartStyle = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const textColor = chartStyle.textColor;
    const axisColor = chartStyle.axisColor;
    const gridColor = chartStyle.gridColor;
    const tooltipBackgroundColor = chartStyle.tooltipBackgroundColor;
    const tooltipBorderColor = chartStyle.tooltipBorderColor;
    const isCompactLayout = chartStyle.isCompactLayout;
    const axisFontSize = chartStyle.axisFontSize;
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const showValueLabels = points.length > 0 && points.length <= 200;

    if (!points.length) {
      return {
        animation: this.useAnimations === true,
        tooltip: { show: false },
        legend: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
        graphic: []
      };
    }

    const values = points
      .map(point => point.value)
      .filter((value): value is number => Number.isFinite(value));
    const valueAxisConfig = buildDashboardValueAxisConfig(values);

    const categories = points.map(point => point.label);
    const lineData = points.map((point) => {
      const pointColor = this.getPointColor(point, point.index);
      return {
        value: point.value,
        itemStyle: {
          color: pointColor,
          borderColor: pointColor
        }
      };
    });

    const shouldRenderTrend = this.vertical
      && this.chartDataCategoryType === ChartDataCategoryTypes.DateType;
    const trendSeries = shouldRenderTrend
      ? this.buildTrendSeries(points, chartStyle.trendLineColor)
      : null;

    const summaryLabel = aggregate
      ? normalizeUnitDerivedTypeLabel(aggregate.getType(), aggregate.getDisplayType())
      : (this.chartDataValueType || 'Value');
    const summaryValue = formatDashboardDataDisplay(aggregate);
    const summaryMeta = getDashboardSummaryMetaLabel(
      this.chartDataCategoryType,
      this.chartDataValueType,
      this.chartDataTimeInterval
    );

    const categoryLabelFormatter = (value: string, index: number): string => {
      if (
        this.chartDataCategoryType === ChartDataCategoryTypes.DateType
        && (!points[index] || !Number.isFinite(points[index].value))
      ) {
        return '';
      }
      return value;
    };

    const categoryAxis = {
      type: 'category',
      data: categories,
      boundaryGap: false,
      inverse: !this.vertical,
      axisLine: {
        lineStyle: { color: axisColor }
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: textColor,
        fontSize: axisFontSize,
        hideOverlap: true,
        interval: 0,
        formatter: categoryLabelFormatter,
        rotate: this.vertical && this.chartDataCategoryType === ChartDataCategoryTypes.DateType
          ? (isCompactLayout ? 54 : 42)
          : 0
      }
    };

    const valueAxis = {
      type: 'value',
      min: valueAxisConfig.min,
      max: valueAxisConfig.max,
      interval: valueAxisConfig.interval,
      axisLine: {
        lineStyle: { color: axisColor }
      },
      axisTick: { show: false },
      splitLine: {
        show: true,
        lineStyle: { color: gridColor }
      },
      axisLabel: {
        color: textColor,
        fontSize: axisFontSize,
        formatter: (value: number) => this.formatValue(value)
      }
    };

    return {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
      },
      grid: {
        left: 4,
        right: 8,
        top: 62,
        bottom: isCompactLayout ? 16 : 10,
        containLabel: true
      },
      tooltip: {
        trigger: 'item',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        backgroundColor: tooltipBackgroundColor,
        borderColor: tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: isCompactLayout ? 12 : 13
        },
        formatter: (params: { dataIndex: number }) => this.formatTooltip(points, params.dataIndex)
      },
      legend: { show: false },
      xAxis: this.vertical ? categoryAxis : valueAxis,
      yAxis: this.vertical ? valueAxis : categoryAxis,
      series: [
        {
          type: 'line',
          data: lineData,
          smooth: false,
          connectNulls: true,
          symbol: 'circle',
          symbolSize: isCompactLayout ? 6 : 7,
          showSymbol: true,
          clip: false,
          lineStyle: {
            width: 2.2,
            color: chartStyle.trendLineColor
          },
          label: {
            show: showValueLabels,
            position: this.vertical ? 'top' : 'right',
            color: textColor,
            fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
            fontSize: isCompactLayout ? 11 : 12,
            formatter: (params: { dataIndex: number }) => {
              const point = points[params.dataIndex];
              if (!point || !Number.isFinite(point.value)) {
                return '';
              }
              return this.formatValue(point.value);
            }
          },
          emphasis: {
            focus: 'series'
          },
          z: 20
        },
        ...(trendSeries ? [trendSeries] : [])
      ],
      graphic: [
        {
          type: 'group',
          left: 8,
          top: 4,
          bounding: 'raw',
          children: [
            {
              type: 'text',
              style: {
                text: summaryLabel,
                fontSize: isCompactLayout ? 12 : 13,
                fontWeight: 500,
                fill: textColor,
                opacity: 0.85,
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
              },
              left: 0,
              top: 0
            },
            {
              type: 'text',
              style: {
                text: summaryValue,
                fontSize: isCompactLayout ? 20 : 22,
                fontWeight: 700,
                fill: textColor,
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
              },
              left: 0,
              top: 14
            },
            {
              type: 'text',
              style: {
                text: summaryMeta,
                fontSize: isCompactLayout ? 11 : 12,
                fontWeight: 500,
                fill: textColor,
                opacity: 0.72,
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
              },
              left: 0,
              top: isCompactLayout ? 38 : 40
            }
          ]
        }
      ]
    };
  }

  private buildTrendSeries(points: DashboardCartesianPoint[], trendLineColor: string): Record<string, unknown> | null {
    const regressionLine = buildDashboardDateRegressionLine(points);
    if (regressionLine.length < 2) {
      return null;
    }

    return {
      type: 'line',
      name: 'Trend',
      data: regressionLine.map(point => point.y),
      symbol: 'none',
      smooth: false,
      z: 30,
      lineStyle: {
        width: 1.5,
        type: 'dashed',
        color: trendLineColor
      },
      tooltip: {
        show: false
      }
    };
  }

  private getPointColor(point: DashboardCartesianPoint, index: number): string {
    if (this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
      if (point.activityType) {
        return this.eventColorService.getColorForActivityTypeByActivityTypeGroup(point.activityType as ActivityTypes);
      }
      return this.dateTypePalette[index % this.dateTypePalette.length];
    }
    return this.dateTypePalette[index % this.dateTypePalette.length];
  }

  private formatValue(value: number | null): string {
    return formatDashboardNumericValue(this.chartDataType, value, this.logger);
  }

  private formatTooltip(points: DashboardCartesianPoint[], dataIndex: number): string {
    const point = points[dataIndex];
    if (!point || !Number.isFinite(point.value)) {
      return '';
    }

    const valueText = this.formatValue(point.value);
    const valueTypeLabel = this.chartDataValueType || 'Value';
    const activityCountLabel = point.count > 0 ? `<br/>${point.count} Activities` : '';
    return `${point.label}<br/>${valueTypeLabel}: <strong>${valueText}</strong>${activityCountLabel}`;
  }
}
