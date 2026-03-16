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
import {
  buildDashboardDateActivitySegmentation,
  DashboardDateActivityBucket,
  DashboardDateActivitySegmentationResult,
  DashboardDateActivitySeriesEntry
} from '../../../helpers/dashboard-date-activity-segmentation.helper';
import { normalizeUnitDerivedTypeLabel } from '../../../helpers/stat-label.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-columns-chart',
  templateUrl: './charts.columns.component.html',
  styleUrls: ['./charts.columns.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsColumnsComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() data: any;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() isLoading = false;

  @Input() vertical = true;
  @Input() type: 'columns' | 'pyramids' = 'columns';

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

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private eventColorService: AppEventColorService,
    private logger: LoggerService
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsColumnsComponent]'
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
      changes.vertical ||
      changes.type
    ) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private readonly stackedActivitySeriesKey = 'date-activity-stack';
  private readonly stackedTotalLabelSeriesName = '__date_activity_totals__';

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
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
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
    const isDateCategory = this.chartDataCategoryType === ChartDataCategoryTypes.DateType;
    const dateActivitySegmentation = isDateCategory
      ? buildDashboardDateActivitySegmentation({
        rawData: this.data,
        points,
        chartDataValueType: this.chartDataValueType
      })
      : null;
    const useDateActivitySegmentation = isDateCategory && !!dateActivitySegmentation;
    const showValueLabels = points.length > 0 && points.length <= 200 && !useDateActivitySegmentation;

    if (!points.length) {
      return {
        animation: this.useAnimations === true,
        legend: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const values = points
      .map(point => point.value)
      .filter((value): value is number => Number.isFinite(value));
    const valueAxisConfig = buildDashboardValueAxisConfig(values);
    const categories = points.map(point => point.label);

    const seriesData = points.map((point, index) => ({
      value: point.value,
      itemStyle: {
        color: this.getPointColor(point, index)
      }
    }));

    const dateActivityColorMap = useDateActivitySegmentation
      ? this.buildDateActivityColorMap(dateActivitySegmentation)
      : null;
    const segmentedDataSeries = useDateActivitySegmentation
      ? this.buildDateActivitySeries(
        dateActivitySegmentation,
        dateActivityColorMap as Map<string, string>,
        isCompactLayout
      )
      : [this.buildBarSeries(
        seriesData,
        showValueLabels,
        textColor,
        isCompactLayout,
        points
      )];
    const totalLabelSeries = useDateActivitySegmentation && dateActivitySegmentation
      ? this.buildDateActivityTotalLabelSeries(dateActivitySegmentation, textColor, isCompactLayout)
      : null;
    const dataSeries = totalLabelSeries
      ? [...segmentedDataSeries, totalLabelSeries]
      : segmentedDataSeries;
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

    const categoryAxis = {
      type: 'category',
      data: categories,
      inverse: !this.vertical,
      axisLine: {
        show: this.vertical,
        lineStyle: { color: axisColor }
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: textColor,
        fontSize: axisFontSize,
        hideOverlap: true,
        interval: 0,
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
        left: this.vertical ? 4 : 6,
        right: 8,
        top: 62,
        bottom: this.vertical ? (isCompactLayout ? 16 : 10) : 8,
        containLabel: true
      },
      tooltip: {
        trigger: useDateActivitySegmentation ? 'axis' : 'item',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        axisPointer: useDateActivitySegmentation ? { type: 'shadow' } : undefined,
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
        formatter: useDateActivitySegmentation && dateActivitySegmentation && dateActivityColorMap
          ? (params: any) => this.formatDateActivityTooltip(
            dateActivitySegmentation.buckets,
            params,
            dateActivityColorMap
          )
          : (params: { dataIndex: number }) => this.formatTooltip(points, params.dataIndex)
      },
      legend: { show: false },
      xAxis: this.vertical ? categoryAxis : valueAxis,
      yAxis: this.vertical ? valueAxis : categoryAxis,
      series: trendSeries ? [...dataSeries, trendSeries] : dataSeries,
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
                fontFamily: "'Barlow Condensed', sans-serif"
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
                fontFamily: "'Barlow Condensed', sans-serif"
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
                fontFamily: "'Barlow Condensed', sans-serif"
              },
              left: 0,
              top: isCompactLayout ? 38 : 40
            }
          ]
        }
      ]
    };
  }

  private buildDateActivityColorMap(
    segmentation: DashboardDateActivitySegmentationResult
  ): Map<string, string> {
    const colorMap = new Map<string, string>();
    segmentation.series.forEach((seriesEntry, index) => {
      colorMap.set(seriesEntry.key, this.getActivitySeriesColor(seriesEntry, index));
    });
    return colorMap;
  }

  private getActivitySeriesColor(seriesEntry: DashboardDateActivitySeriesEntry, index: number): string {
    if (seriesEntry.activityType) {
      return this.eventColorService.getColorForActivityTypeByActivityTypeGroup(seriesEntry.activityType);
    }
    return this.dateTypePalette[index % this.dateTypePalette.length];
  }

  private buildDateActivitySeries(
    segmentation: DashboardDateActivitySegmentationResult,
    colorMap: Map<string, string>,
    isCompactLayout: boolean
  ): Record<string, unknown>[] {
    if (this.type === 'pyramids' && this.vertical) {
      return this.buildSegmentedPyramidSeries(segmentation, colorMap);
    }
    return this.buildSegmentedStackedBarSeries(segmentation, colorMap, isCompactLayout);
  }

  private buildDateActivityTotalLabelSeries(
    segmentation: DashboardDateActivitySegmentationResult,
    textColor: string,
    isCompactLayout: boolean
  ): Record<string, unknown> {
    return {
      type: 'custom',
      name: this.stackedTotalLabelSeriesName,
      z: 200,
      silent: true,
      animation: this.useAnimations === true,
      data: segmentation.buckets.map((bucket) => [bucket.index, bucket.total]),
      renderItem: (params: any, api: any) => this.renderDateActivityTotalLabel(params, api, textColor, isCompactLayout),
      tooltip: { show: false }
    };
  }

  private renderDateActivityTotalLabel(
    params: any,
    api: any,
    textColor: string,
    isCompactLayout: boolean
  ): Record<string, unknown> | null {
    const categoryIndex = Number(api.value(0));
    const total = Number(api.value(1));
    if (!Number.isFinite(categoryIndex) || !Number.isFinite(total) || total === 0) {
      return null;
    }

    const coord = this.vertical
      ? api.coord([categoryIndex, total])
      : api.coord([total, categoryIndex]);
    const offsetX = this.vertical ? 0 : 8;
    const offsetY = this.vertical ? -8 : 0;

    return {
      type: 'text',
      x: coord[0] + offsetX,
      y: coord[1] + offsetY,
      style: {
        text: this.formatValue(total),
        fill: textColor,
        fontFamily: "'Barlow Condensed', sans-serif",
        fontSize: isCompactLayout ? 11 : 12,
        fontWeight: 700,
        textAlign: this.vertical ? 'center' : 'left',
        textVerticalAlign: this.vertical ? 'bottom' : 'middle'
      }
    };
  }

  private buildSegmentedStackedBarSeries(
    segmentation: DashboardDateActivitySegmentationResult,
    colorMap: Map<string, string>,
    isCompactLayout: boolean
  ): Record<string, unknown>[] {
    return segmentation.series.map((seriesEntry) => ({
      type: 'bar',
      name: seriesEntry.label,
      stack: this.stackedActivitySeriesKey,
      animation: this.useAnimations === true,
      data: segmentation.buckets.map((bucket) => {
        if (!Number.isFinite(bucket.total)) {
          return null;
        }
        return bucket.segments.find((segment) => segment.activityKey === seriesEntry.key)?.value ?? 0;
      }),
      barMaxWidth: this.vertical ? (isCompactLayout ? 28 : 36) : (isCompactLayout ? 20 : 24),
      itemStyle: {
        color: colorMap.get(seriesEntry.key) || this.dateTypePalette[0]
      },
      label: {
        show: false
      },
      emphasis: {
        focus: 'series'
      }
    }));
  }

  private buildSegmentedPyramidSeries(
    segmentation: DashboardDateActivitySegmentationResult,
    colorMap: Map<string, string>
  ): Record<string, unknown>[] {
    const cumulativeBounds = segmentation.buckets.map((bucket) => {
      const boundsByKey = new Map<string, { start: number; end: number }>();
      let cursor = 0;
      segmentation.series.forEach((seriesEntry) => {
        const segmentValue = bucket.segments.find((segment) => segment.activityKey === seriesEntry.key)?.value ?? 0;
        boundsByKey.set(seriesEntry.key, {
          start: cursor,
          end: cursor + segmentValue
        });
        cursor += segmentValue;
      });
      return boundsByKey;
    });

    return segmentation.series.map((seriesEntry, seriesIndex) => ({
      type: 'custom',
      name: seriesEntry.label,
      z: 10 + seriesIndex,
      encode: { x: 0, y: 1, tooltip: [1] },
      animation: this.useAnimations === true,
      itemStyle: {
        color: colorMap.get(seriesEntry.key) || this.dateTypePalette[0]
      },
      data: segmentation.buckets.map((bucket, bucketIndex) => {
        const bounds = cumulativeBounds[bucketIndex].get(seriesEntry.key) || { start: 0, end: 0 };
        return [bucketIndex, bucket.total, bounds.start, bounds.end];
      }),
      renderItem: (params: any, api: any) => this.renderSegmentedPyramidItem(params, api)
    }));
  }

  private renderSegmentedPyramidItem(params: any, api: any): Record<string, unknown> | null {
    const categoryIndex = Number(api.value(0));
    const total = Number(api.value(1));
    const start = Number(api.value(2));
    const end = Number(api.value(3));

    if (!Number.isFinite(categoryIndex) || !Number.isFinite(total) || total <= 0) {
      return null;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }

    const baseCoord = api.coord([categoryIndex, 0]);
    const startCoord = api.coord([categoryIndex, start]);
    const endCoord = api.coord([categoryIndex, end]);
    const centerX = baseCoord[0];
    const bandWidth = Math.max(8, Math.min(56, api.size([1, 0])[0] || 0));
    const baseHalfWidth = bandWidth * 0.48;

    const startRatio = Math.max(0, Math.min(1, start / total));
    const endRatio = Math.max(0, Math.min(1, end / total));
    const startHalfWidth = baseHalfWidth * (1 - startRatio);
    const endHalfWidth = baseHalfWidth * (1 - endRatio);
    const fillColor = api.visual('color');
    const polygonStyle = fillColor ? { fill: fillColor } : {};

    return {
      type: 'polygon',
      shape: {
        points: [
          [centerX - startHalfWidth, startCoord[1]],
          [centerX + startHalfWidth, startCoord[1]],
          [centerX + endHalfWidth, endCoord[1]],
          [centerX - endHalfWidth, endCoord[1]]
        ]
      },
      style: polygonStyle,
      emphasis: {
        style: polygonStyle
      }
    };
  }

  private buildBarSeries(
    seriesData: Array<{ value: number | null; itemStyle: { color: string } }>,
    showValueLabels: boolean,
    textColor: string,
    isCompactLayout: boolean,
    points: DashboardCartesianPoint[]
  ): Record<string, unknown> {
    const barBase = {
      data: seriesData,
      animation: this.useAnimations === true,
      barMaxWidth: this.vertical ? (isCompactLayout ? 28 : 36) : (isCompactLayout ? 20 : 24),
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
      }
    };

    if (this.type === 'pyramids' && this.vertical) {
      return {
        ...barBase,
        type: 'pictorialBar',
        // Triangle path for a clear pyramid silhouette.
        symbol: 'path://M50,0 L100,100 L0,100 Z',
        symbolRepeat: false,
        symbolClip: false,
        symbolSize: ['108%', '100%'],
        symbolPosition: 'end'
      };
    }

    return {
      ...barBase,
      type: 'bar',
      itemStyle: {
        borderRadius: this.vertical ? [6, 6, 0, 0] : [0, 6, 6, 0]
      }
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

  private formatDateActivityTooltip(
    buckets: DashboardDateActivityBucket[],
    params: any,
    colorMap: Map<string, string>
  ): string {
    const paramArray = Array.isArray(params) ? params : [params];
    const firstWithDataIndex = paramArray.find((entry) => Number.isFinite(entry?.dataIndex));
    const dataIndex = Number(firstWithDataIndex?.dataIndex);
    if (!Number.isFinite(dataIndex)) {
      return '';
    }

    const bucket = buckets[dataIndex];
    if (!bucket) {
      return '';
    }
    if (!Number.isFinite(bucket.total)) {
      return '';
    }

    const totalText = this.formatValue(bucket.total);
    const valueTypeLabel = this.chartDataValueType || 'Value';
    const activityCountLabel = bucket.count > 0 ? `<br/>${bucket.count} Activities` : '';
    const lines = bucket.segments
      .filter((segment) => Number.isFinite(segment.value) && segment.value !== 0)
      .map((segment, index) => {
        const color = colorMap.get(segment.activityKey) || this.dateTypePalette[index % this.dateTypePalette.length];
        const marker = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};margin-right:6px;"></span>`;
        const valueText = this.formatValue(segment.value);
        const countText = segment.count > 0 ? `, ${segment.count} Activities` : '';
        return `${marker}${segment.label}: <strong>${valueText}</strong> (${segment.percent.toFixed(1)}%)${countText}`;
      });

    const breakdownText = lines.length ? `<br/>${lines.join('<br/>')}` : '';
    return `${bucket.label}<br/>${valueTypeLabel}: <strong>${totalText}</strong>${activityCountLabel}${breakdownText}`;
  }
}
