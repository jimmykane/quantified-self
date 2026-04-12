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
  DataDuration,
  DataRecoveryTime,
  TimeIntervals,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
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
  ECHARTS_SERIES_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../helpers/echarts-host-controller';
import { buildDashboardEChartsStyleTokens } from '../../../helpers/dashboard-echarts-style.helper';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import {
  formatDashboardDataDisplay,
  formatDashboardNumericValue,
  getDashboardAggregateData,
  getDashboardChartSortComparator,
  getDashboardDataInstanceOrNull,
  getDashboardSummaryMetaLabel
} from '../../../helpers/dashboard-chart-data.helper';
import {
  resolveActiveRecoveryTotalSeconds,
  resolveRemainingRecoverySeconds,
  type DashboardRecoveryNowContext,
} from '../../../helpers/dashboard-recovery-now.helper';
import {
  type DashboardDerivedMetricStatus,
  isDerivedMetricPendingStatus,
} from '../../../helpers/derived-metric-status.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type ChartSetOptionSettings = Parameters<EChartsType['setOption']>[1];
@Component({
  selector: 'app-pie-chart',
  templateUrl: './charts.pie.component.html',
  styleUrls: ['./charts.pie.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsPieComponent implements AfterViewInit, OnChanges, OnDestroy {
  private static readonly RECOVERY_REFRESH_INTERVAL_MS = 60 * 1000;

  @Input() data: any;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() isLoading = false;
  @Input() userUnitSettings?: UserUnitSettingsInterface | null;
  @Input() recoveryNow?: DashboardRecoveryNowContext | null;
  @Input() recoveryNowStatus?: DashboardDerivedMetricStatus | null;
  // Curated recovery is a dedicated dashboard chart type. Keep generic pie behavior isolated.
  @Input() enableRecoveryNowMode = false;

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
  private static readonly EMPTY_DATA_UPDATE_SETTINGS: ChartSetOptionSettings = {
    notMerge: true,
    lazyUpdate: false
  };
  private recoveryRefreshIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private recoveryDebugSignature: string | null = null;
  public showNoDataError = false;
  public noDataErrorMessage = 'No data yet';
  public noDataErrorHint = 'Try a different date range or metric';
  public noDataErrorIcon = 'pie_chart';

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
    this.updateNoDataErrorState();
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.updateNoDataErrorState();
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
      changes.userUnitSettings ||
      changes.recoveryNow
    ) {
      this.updateRecoveryRefreshTimer();
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.clearRecoveryRefreshTimer();
    this.chartHost.dispose();
  }

  private async refreshChart(): Promise<void> {
    this.updateNoDataErrorState();
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
    this.chartHost.hideTooltip();
    this.chartHost.setOption(
      option,
      hasRenderableSeries(option)
        ? ECHARTS_SERIES_IMMEDIATE_UPDATE_SETTINGS
        : ChartsPieComponent.EMPTY_DATA_UPDATE_SETTINGS
    );
    this.chartHost.scheduleResize();
    this.updateRecoveryRefreshTimer();
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
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const recoverySeriesData = this.buildRecoverySeriesData(chartStyle.subtleBorderColor);
    const seriesData = recoverySeriesData || pieData.slices.map((slice, index) => ({
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
        tooltip: { show: false },
        legend: { show: false },
        series: [],
        graphic: []
      };
    }

    const recoverySummary = this.getRecoverySummaryOverride();
    const centerLabel = recoverySummary?.label ?? (aggregateData
      ? normalizeUnitDerivedTypeLabel(aggregateData.getType(), aggregateData.getDisplayType())
      : (this.chartDataValueType || 'Value'));
    const centerValue = recoverySummary?.value ?? formatDashboardDataDisplay(aggregateData, this.getNormalizedUnitSettings());
    const centerSubLabel = recoverySummary?.meta ?? getDashboardSummaryMetaLabel(
      this.chartDataCategoryType,
      this.chartDataValueType,
      this.chartDataTimeInterval
    );

    return {
      animation: this.useAnimations === true,
      backgroundColor: 'transparent',
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif"
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
        formatter: (params: { data?: any }) => {
          const entry = params?.data;
          if (!entry) {
            return '';
          }
          const valueText = formatDashboardNumericValue(
            this.chartDataType,
            entry.value,
            this.logger,
            this.getNormalizedUnitSettings(),
          );
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

  private getRecoverySummaryOverride(): { label: string; value: string; meta: string } | null {
    if (!this.enableRecoveryNowMode || this.chartDataType !== DataRecoveryTime.type) {
      return null;
    }

    const context = this.recoveryNow;
    const nowMs = Date.now();
    const activeTotalSeconds = resolveActiveRecoveryTotalSeconds(context, nowMs);
    const remainingSeconds = resolveRemainingRecoverySeconds(context, nowMs);
    if (activeTotalSeconds === null || activeTotalSeconds <= 0 || remainingSeconds === null) {
      return null;
    }

    const normalizedUnitSettings = this.getNormalizedUnitSettings();
    const totalText = formatDashboardNumericValue(
      DataDuration.type,
      activeTotalSeconds,
      this.logger,
      normalizedUnitSettings,
    );
    const remainingText = formatDashboardNumericValue(
      DataDuration.type,
      remainingSeconds,
      this.logger,
      normalizedUnitSettings,
    );
    return {
      label: 'Recovery Left Now',
      value: remainingText,
      meta: `Total recovery: ${totalText}`,
    };
  }

  private shouldEnableRecoveryRefreshTimer(): boolean {
    if (!this.enableRecoveryNowMode || this.chartDataType !== DataRecoveryTime.type) {
      return false;
    }
    const remainingSeconds = resolveRemainingRecoverySeconds(this.recoveryNow, Date.now());
    return remainingSeconds !== null && remainingSeconds > 0;
  }

  private updateRecoveryRefreshTimer(): void {
    if (!this.shouldEnableRecoveryRefreshTimer()) {
      this.clearRecoveryRefreshTimer();
      return;
    }

    if (this.recoveryRefreshIntervalHandle !== null) {
      return;
    }

    this.recoveryRefreshIntervalHandle = setInterval(() => {
      void this.refreshChart();
    }, ChartsPieComponent.RECOVERY_REFRESH_INTERVAL_MS);
  }

  private clearRecoveryRefreshTimer(): void {
    if (this.recoveryRefreshIntervalHandle === null) {
      return;
    }
    clearInterval(this.recoveryRefreshIntervalHandle);
    this.recoveryRefreshIntervalHandle = null;
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

  private getNormalizedUnitSettings(): UserUnitSettingsInterface {
    return normalizeUserUnitSettings(this.userUnitSettings);
  }

  private buildRecoverySeriesData(subtleBorderColor: string): Array<{
    name: string;
    value: number;
    count: number;
    percent: number;
    itemStyle: { color: string; borderColor: string; borderWidth: number };
  }> | null {
    if (!this.enableRecoveryNowMode || this.chartDataType !== DataRecoveryTime.type) {
      this.logRecoveryDebugState('mode_disabled');
      return null;
    }

    const context = this.recoveryNow;
    if (!context) {
      this.logRecoveryDebugState('missing_context');
      return null;
    }
    const nowMs = Date.now();
    const activeTotalSeconds = resolveActiveRecoveryTotalSeconds(context, nowMs);
    const remainingSeconds = resolveRemainingRecoverySeconds(context, nowMs);
    if (activeTotalSeconds === null || activeTotalSeconds <= 0 || remainingSeconds === null) {
      this.logRecoveryDebugState('no_active_recovery', {
        activeTotalSeconds,
        remainingSeconds,
        totalSeconds: context.totalSeconds,
        segments: Array.isArray(context.segments) ? context.segments.length : 0,
      });
      return null;
    }

    const elapsedSeconds = Math.max(0, activeTotalSeconds - remainingSeconds);
    const leftPercent = activeTotalSeconds > 0 ? (remainingSeconds / activeTotalSeconds) * 100 : 0;
    const elapsedPercent = activeTotalSeconds > 0 ? (elapsedSeconds / activeTotalSeconds) * 100 : 0;

    return [
      {
        name: 'Left now',
        value: remainingSeconds,
        count: 0,
        percent: leftPercent,
        itemStyle: {
          color: AppColors.Green,
          borderColor: subtleBorderColor,
          borderWidth: 1.2
        }
      },
      {
        name: 'Elapsed',
        value: elapsedSeconds,
        count: 0,
        percent: elapsedPercent,
        itemStyle: {
          color: AppColors.DarkGray,
          borderColor: subtleBorderColor,
          borderWidth: 1.2
        }
      }
    ];
  }

  private logRecoveryDebugState(
    state: string,
    data?: Record<string, unknown>,
  ): void {
    const signature = `${state}:${JSON.stringify(data || {})}`;
    if (this.recoveryDebugSignature === signature) {
      return;
    }
    this.recoveryDebugSignature = signature;
    this.logger?.log?.('[debug][recovery-now] pie_series_state', {
      state,
      ...(data || {}),
    });
  }

  private updateNoDataErrorState(): void {
    this.applyNoDataOverlayState('default');

    const hasArrayData = Array.isArray(this.data);
    if (!hasArrayData) {
      this.showNoDataError = false;
      return;
    }

    if (this.data.length > 0) {
      this.showNoDataError = false;
      return;
    }

    if (!this.enableRecoveryNowMode || this.chartDataType !== DataRecoveryTime.type) {
      this.showNoDataError = true;
      return;
    }

    const nowMs = Date.now();
    const activeTotalSeconds = resolveActiveRecoveryTotalSeconds(this.recoveryNow, nowMs);
    const remainingSeconds = resolveRemainingRecoverySeconds(this.recoveryNow, nowMs);
    const hasRenderableRecovery = activeTotalSeconds !== null
      && activeTotalSeconds > 0
      && remainingSeconds !== null;
    if (hasRenderableRecovery) {
      this.showNoDataError = false;
      return;
    }

    const status = this.recoveryNowStatus;
    if (isDerivedMetricPendingStatus(status)) {
      this.applyNoDataOverlayState('updating');
      this.showNoDataError = true;
      return;
    }

    if (status === 'ready') {
      this.applyNoDataOverlayState('fully-recovered');
      this.showNoDataError = true;
      return;
    }

    this.showNoDataError = true;
  }

  private applyNoDataOverlayState(
    state: 'default' | 'updating' | 'fully-recovered',
  ): void {
    if (state === 'updating') {
      this.noDataErrorMessage = 'Recovery is updating';
      this.noDataErrorHint = 'We are recalculating your current recovery window.';
      this.noDataErrorIcon = 'autorenew';
      return;
    }

    if (state === 'fully-recovered') {
      this.noDataErrorMessage = 'No active recovery now';
      this.noDataErrorHint = 'You are fully recovered based on your latest activities.';
      this.noDataErrorIcon = 'verified';
      return;
    }

    this.noDataErrorMessage = 'No data yet';
    this.noDataErrorHint = 'Try a different date range or metric';
    this.noDataErrorIcon = 'pie_chart';
  }
}

function hasRenderableSeries(option: ChartOption): boolean {
  const series = (option as { series?: unknown }).series;
  return Array.isArray(series) && series.length > 0;
}
