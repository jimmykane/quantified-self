import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  NgZone,
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
  ChartThemes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { AppColors } from '../../../services/color/app.colors';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { EChartsHostController } from '../../../helpers/echarts-host-controller';
import { isDarkChartThemeActive } from '../../../helpers/echarts-theme.helper';
import {
  getDashboardAggregateData,
  getDashboardDataInstanceOrNull
} from '../../../helpers/dashboard-chart-data.helper';
import {
  buildDashboardCartesianPoints,
  buildDashboardDateRegressionLine,
  DashboardCartesianPoint
} from '../../../helpers/dashboard-echarts-cartesian.helper';
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
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
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
    private zone: NgZone,
    private eChartsLoader: EChartsLoaderService,
    private eventColorService: AppEventColorService,
    private logger: LoggerService
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      zone: this.zone,
      logger: this.logger,
      logPrefix: '[ChartsColumnsComponent]'
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.chartHost.init(this.chartDiv?.nativeElement);
    this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartHost.getChart()) {
      return;
    }

    if (
      changes.data ||
      changes.chartTheme ||
      changes.useAnimations ||
      changes.chartDataType ||
      changes.chartDataValueType ||
      changes.chartDataCategoryType ||
      changes.chartDataTimeInterval ||
      changes.vertical ||
      changes.type
    ) {
      this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private refreshChart(): void {
    if (!this.chartHost.getChart()) {
      return;
    }

    const points = buildDashboardCartesianPoints({
      data: this.data,
      chartDataValueType: this.chartDataValueType,
      chartDataCategoryType: this.chartDataCategoryType,
      chartDataTimeInterval: this.chartDataTimeInterval
    });
    const aggregateSourceData = this.chartDataValueType
      ? points.map((point) => ({ [this.chartDataValueType as string]: point.value }))
      : [];
    const aggregate = getDashboardAggregateData(
      aggregateSourceData,
      this.chartDataValueType,
      this.chartDataType,
      this.logger
    );
    const option = this.buildChartOption(points, aggregate);
    this.chartHost.setOption(option, { notMerge: true, lazyUpdate: true });
    this.chartHost.scheduleResize();
  }

  private buildChartOption(
    points: DashboardCartesianPoint[],
    aggregate: ReturnType<typeof getDashboardAggregateData>
  ): ChartOption {
    const darkTheme = isDarkChartThemeActive(this.chartTheme);
    const textColor = darkTheme ? '#f5f5f5' : '#1f1f1f';
    const axisColor = darkTheme ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.24)';
    const gridColor = darkTheme ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    const tooltipBackgroundColor = darkTheme ? '#303030' : '#ffffff';
    const tooltipBorderColor = darkTheme ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const isCompactLayout = chartWidth > 0 && chartWidth < 680;
    const axisFontSize = isCompactLayout ? 11 : 12;
    const showValueLabels = points.length > 0 && points.length <= 200;

    if (!points.length) {
      return {
        animation: this.useAnimations === true,
        legend: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const values = points.map(point => point.value);
    const valueMin = Math.min(...values);
    const valueMax = Math.max(...values);
    const axisMin = valueMin < 0 ? valueMin * 1.1 : 0;
    let axisMax = valueMax > 0 ? valueMax * 1.1 : 0;
    if (axisMin === axisMax) {
      axisMax = axisMin + 1;
    }
    const categories = points.map(point => point.label);

    const seriesData = points.map((point, index) => ({
      value: point.value,
      itemStyle: {
        color: this.getPointColor(point, index)
      }
    }));

    const barSeries = this.buildBarSeries(
      seriesData,
      showValueLabels,
      textColor,
      isCompactLayout,
      points
    );
    const shouldRenderTrend = this.vertical
      && this.chartDataCategoryType === ChartDataCategoryTypes.DateType;
    const trendSeries = shouldRenderTrend
      ? this.buildTrendSeries(points, darkTheme)
      : null;

    const summaryLabel = aggregate
      ? normalizeUnitDerivedTypeLabel(aggregate.getType(), aggregate.getDisplayType())
      : (this.chartDataValueType || 'Value');
    const summaryValue = aggregate
      ? `${aggregate.getDisplayValue()}${aggregate.getDisplayUnit()}`
      : '--';
    const intervalLabel = this.chartDataCategoryType === ChartDataCategoryTypes.DateType
      ? ` @ ${TimeIntervals[this.chartDataTimeInterval || TimeIntervals.Daily]}`
      : '';
    const summaryMeta = `${this.chartDataValueType || 'Value'}${intervalLabel}`;

    const categoryAxis = {
      type: 'category',
      data: categories,
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
        rotate: this.vertical && this.chartDataCategoryType === ChartDataCategoryTypes.DateType
          ? (isCompactLayout ? 54 : 42)
          : 0
      }
    };

    const valueAxis = {
      type: 'value',
      min: axisMin,
      max: axisMax,
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
        fontFamily: "'Barlow Condensed', sans-serif"
      },
      grid: {
        left: this.vertical ? 4 : 6,
        right: 8,
        top: 62,
        bottom: this.vertical ? (isCompactLayout ? 16 : 10) : 8,
        containLabel: true
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: tooltipBackgroundColor,
        borderColor: tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: isCompactLayout ? 12 : 13
        },
        formatter: (params: { dataIndex: number }) => this.formatTooltip(points, params.dataIndex)
      },
      legend: { show: false },
      xAxis: this.vertical ? categoryAxis : valueAxis,
      yAxis: this.vertical ? valueAxis : categoryAxis,
      series: trendSeries ? [barSeries, trendSeries] : [barSeries],
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

  private buildBarSeries(
    seriesData: Array<{ value: number; itemStyle: { color: string } }>,
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
        fontFamily: "'Barlow Condensed', sans-serif",
        fontSize: isCompactLayout ? 11 : 12,
        formatter: (params: { dataIndex: number }) => {
          const point = points[params.dataIndex];
          if (!point) {
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

  private buildTrendSeries(points: DashboardCartesianPoint[], darkTheme: boolean): Record<string, unknown> | null {
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
        color: darkTheme ? '#9a9a9a' : '#6b6b6b'
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

  private formatValue(value: number): string {
    const data = getDashboardDataInstanceOrNull(this.chartDataType, value, this.logger);
    if (!data) {
      return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return `${data.getDisplayValue()}${data.getDisplayUnit()}`;
  }

  private formatTooltip(points: DashboardCartesianPoint[], dataIndex: number): string {
    const point = points[dataIndex];
    if (!point) {
      return '';
    }

    const valueText = this.formatValue(point.value);
    const valueTypeLabel = this.chartDataValueType || 'Value';
    const activityCountLabel = point.count > 0 ? `<br/>${point.count} Activities` : '';
    return `${point.label}<br/>${valueTypeLabel}: <strong>${valueText}</strong>${activityCountLabel}`;
  }
}
