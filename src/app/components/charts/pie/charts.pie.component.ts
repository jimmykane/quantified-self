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
  ActivityTypesHelper,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { AppColors } from '../../../services/color/app.colors';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import { normalizeUnitDerivedTypeLabel } from '../../../helpers/stat-label.helper';
import {
  DashboardPieChartData,
  DashboardPieSlice,
  buildDashboardPieChartData,
  getDashboardPieSliceDisplayLabel
} from '../../../helpers/dashboard-pie-chart-data.helper';
import {
  ECHARTS_SERIES_MERGE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../helpers/echarts-host-controller';
import { buildDashboardEChartsStyleTokens } from '../../../helpers/dashboard-echarts-style.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import {
  getDashboardAggregateData,
  getDashboardChartSortComparator,
  getDashboardDataInstanceOrNull,
  getDashboardSummaryMetaLabel
} from '../../../helpers/dashboard-chart-data.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-pie-chart',
  templateUrl: './charts.pie.component.html',
  styleUrls: ['./charts.pie.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsPieComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() data: any;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() isLoading = false;

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private readonly dateTypePalette: string[] = [
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
      logPrefix: '[ChartsPieComponent]'
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
      changes.chartDataTimeInterval
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

    const sortedData = Array.isArray(this.data)
      ? [...this.data].sort(getDashboardChartSortComparator(this.chartDataCategoryType, this.chartDataValueType))
      : [];

    const pieData = buildDashboardPieChartData({
      data: sortedData,
      chartDataValueType: this.chartDataValueType,
      chartDataCategoryType: this.chartDataCategoryType,
      thresholdPercent: 0
    });

    const aggregate = getDashboardAggregateData(
      sortedData,
      this.chartDataValueType,
      this.chartDataType,
      this.logger
    );
    const option = this.buildChartOption(pieData, aggregate);
    this.chartHost.setOption(option, ECHARTS_SERIES_MERGE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildChartOption(
    pieData: DashboardPieChartData,
    aggregateData: ReturnType<typeof getDashboardAggregateData>
  ): ChartOption {
    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const chartStyle = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const darkTheme = chartStyle.darkTheme;
    const textColor = chartStyle.textColor;
    const tooltipBackgroundColor = chartStyle.tooltipBackgroundColor;
    const tooltipBorderColor = chartStyle.tooltipBorderColor;
    const isCompactLayout = chartStyle.isCompactLayout;

    const seriesData = pieData.slices.map((slice, index) => ({
      name: getDashboardPieSliceDisplayLabel(
        slice,
        this.chartDataCategoryType,
        this.chartDataTimeInterval
      ),
      value: slice.value,
      count: slice.count,
      percent: slice.percent,
      itemStyle: {
        color: this.getSliceColor(slice, index),
        borderColor: chartStyle.subtleBorderColor,
        borderWidth: 1.2
      }
    }));
    const showLegend = seriesData.length > 1;
    const pieCenterY = isCompactLayout ? (showLegend ? '44%' : '50%') : '50%';

    if (!seriesData.length) {
      return {
        animation: this.useAnimations === true,
        legend: { show: false },
        series: [],
      };
    }

    const centerLabel = aggregateData
      ? normalizeUnitDerivedTypeLabel(aggregateData.getType(), aggregateData.getDisplayType())
      : (this.chartDataValueType || 'Value');
    const centerValue = aggregateData
      ? `${aggregateData.getDisplayValue()}${aggregateData.getDisplayUnit()}`
      : '--';
    const centerSubLabel = getDashboardSummaryMetaLabel(
      this.chartDataCategoryType,
      this.chartDataValueType,
      this.chartDataTimeInterval
    );

    return {
      animation: this.useAnimations === true,
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif"
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: tooltipBackgroundColor,
        borderColor: tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: isCompactLayout ? 12 : 13
        },
        formatter: (params: { data?: any }) => {
          const entry = params?.data;
          if (!entry) {
            return '';
          }
          const valueDataInstance = getDashboardDataInstanceOrNull(this.chartDataType, entry.value, this.logger);
          const valueText = valueDataInstance
            ? `${valueDataInstance.getDisplayValue()}${valueDataInstance.getDisplayUnit()}`
            : Number(entry.value || 0).toLocaleString();
          const percent = Number(entry.percent || 0).toFixed(1);
          const activitiesCountLabel = entry.count > 0 ? `<br/>${entry.count} Activities` : '';

          return `${entry.name}<br/>${percent}%<br/><strong>${valueText}</strong>${activitiesCountLabel}`;
        }
      },
      legend: {
        show: showLegend,
        orient: isCompactLayout ? 'horizontal' : 'vertical',
        left: isCompactLayout ? 'center' : undefined,
        right: isCompactLayout ? undefined : 6,
        top: isCompactLayout ? 'bottom' : 'middle',
        textStyle: {
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: isCompactLayout ? 12 : 13
        },
        itemGap: isCompactLayout ? 10 : 8
      },
      series: [
        {
          type: 'pie',
          radius: isCompactLayout ? ['42%', '64%'] : ['52%', '72%'],
          center: ['50%', pieCenterY],
          avoidLabelOverlap: true,
          minAngle: 1.5,
          label: {
            show: false,
            color: textColor,
            fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
            formatter: '{b}\n{d}%'
          },
          labelLine: {
            show: false
          },
          data: seriesData
        }
      ],
      graphic: [
        {
          type: 'group',
          left: '50%',
          top: pieCenterY,
          bounding: 'raw',
          children: [
            {
              type: 'text',
              style: {
                text: centerLabel,
                fontSize: isCompactLayout ? 12 : 13,
                fontWeight: 500,
                fill: textColor,
                opacity: 0.86,
                textAlign: 'center',
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
              },
              left: 'center',
              top: isCompactLayout ? -22 : -24
            },
            {
              type: 'text',
              style: {
                text: centerValue,
                fontSize: isCompactLayout ? 22 : 26,
                fontWeight: 700,
                fill: textColor,
                textAlign: 'center',
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
              },
              left: 'center',
              top: isCompactLayout ? -2 : -4
            },
            {
              type: 'text',
              style: {
                text: centerSubLabel,
                fontSize: isCompactLayout ? 11 : 12,
                fontWeight: 500,
                fill: textColor,
                opacity: 0.7,
                textAlign: 'center',
                fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
              },
              left: 'center',
              top: isCompactLayout ? 20 : 24
            }
          ]
        }
      ]
    };
  }

  private getSliceColor(slice: DashboardPieSlice, index: number): string {
    if (this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
      if (slice.isOther) {
        return AppColors.DarkGray;
      }

      const activityType = ActivityTypesHelper.resolveActivityType(slice.label);
      if (activityType !== undefined) {
        return this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType);
      }
    }

    return this.dateTypePalette[index % this.dateTypePalette.length];
  }
}
