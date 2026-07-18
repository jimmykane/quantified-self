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
  computed,
  signal,
} from '@angular/core';
import type { EChartsType } from 'echarts/core';
import { TimeIntervals } from '@sports-alliance/sports-lib';
import { AppColors } from '../../../services/color/app.colors';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../../helpers/echarts-host-controller';
import {
  buildDashboardEChartsTooltipChrome,
  buildDashboardEChartsStyleTokens,
  renderDashboardEChartsTooltipCard,
} from '../../../helpers/dashboard-echarts-style.helper';
import { buildDashboardValueAxisConfig } from '../../../helpers/dashboard-echarts-yaxis.helper';
import {
  type EChartsMobileTapFeedbackOptions,
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipTriggerOn,
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { formatDashboardDateByInterval } from '../../../helpers/dashboard-chart-data.helper';
import {
  buildDashboardFormRenderPoints,
  DashboardFormPoint,
  extendDashboardFormPointsWithZeroLoadUntil,
  resolveDashboardFormCurrentPoint,
  resolveDashboardFormLatestPoint,
  resolveDashboardFormStatus,
  resolveDashboardFormValue,
} from '../../../helpers/dashboard-form.helper';
import {
  formatDashboardFormXAxisLabel,
  resolveDashboardFormXAxisLabelConfig,
} from '../../../helpers/dashboard-form-x-axis.helper';
import {
  type DashboardDerivedMetricStatus,
  isDerivedMetricPendingStatus,
} from '../../../helpers/derived-metric-status.helper';
import type { AppDashboardFormTimelineWindow as DashboardFormTimelineWindow } from '../../../models/app-user.interface';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type EChartsTooltipPositionSize = {
  contentSize?: [number, number];
  viewSize?: [number, number];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_VIEW_SPAN_MS = 84 * DAY_MS;
const MONTH_VIEW_SPAN_MS = 365 * DAY_MS;
const FORM_FATIGUE_COLOR = AppColors.Red;

@Component({
  selector: 'app-form-chart',
  templateUrl: './charts.form.component.html',
  styleUrls: ['./charts.form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsFormComponent implements AfterViewInit, OnChanges, OnDestroy {
  private static readonly FORM_MODE = 'same-day' as const;

  readonly granularityOptions: ReadonlyArray<{ key: DashboardFormTimelineWindow; label: string; shortLabel: string }> = [
    { key: 'w', label: 'Week', shortLabel: 'W' },
    { key: 'm', label: 'Month', shortLabel: 'M' },
    { key: 'y', label: 'Year', shortLabel: 'Y' },
  ];

  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() formStatus?: DashboardDerivedMetricStatus | null;
  @Input() infoTooltip?: string | null;
  @Input() reserveTitleActionSpace = false;
  @Input() mobileTapFeedbackOptions?: EChartsMobileTapFeedbackOptions | null;
  @Input()
  set timelineWindow(value: DashboardFormTimelineWindow | null | undefined) {
    if (value !== 'w' && value !== 'm' && value !== 'y') {
      return;
    }
    if (this.selectedTimelineWindowSignal() === value) {
      return;
    }
    this.selectedTimelineWindowSignal.set(value);
    if (this.chartDiv?.nativeElement) {
      void this.refreshChart();
    }
  }
  @Input() set data(value: DashboardFormPoint[] | null | undefined) {
    this.pointsSignal.set(Array.isArray(value) ? value : []);
    if (this.chartDiv?.nativeElement) {
      void this.refreshChart();
    }
  }
  @Input() set absoluteLatestPoint(value: DashboardFormPoint | null | undefined) {
    this.absoluteLatestPointSignal.set(value || null);
  }

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private readonly pointsSignal = signal<DashboardFormPoint[]>([]);
  private readonly absoluteLatestPointSignal = signal<DashboardFormPoint | null>(null);
  private readonly selectedTimelineWindowSignal = signal<DashboardFormTimelineWindow>('w');
  public noDataErrorMessage = 'No data yet';
  public noDataErrorHint = 'Needs events with a Training Stress Score';
  public noDataErrorIcon = 'monitoring';

  readonly hasData = computed(() => this.pointsSignal().length > 0);
  readonly latestRealWorkoutPoint = computed(() => this.absoluteLatestPointSignal() || resolveDashboardFormLatestPoint(this.pointsSignal()));
  readonly latestCurrentDayPoint = computed(() => resolveDashboardFormCurrentPoint(this.pointsSignal()));
  readonly selectedFormValue = computed(() => resolveDashboardFormValue(this.latestCurrentDayPoint(), ChartsFormComponent.FORM_MODE));
  readonly status = computed(() => resolveDashboardFormStatus(this.selectedFormValue()));
  readonly selectedGranularity = computed(() => this.selectedTimelineWindowSignal());
  readonly selectedGranularityLabel = computed(() => this.resolveGranularityLabel(this.selectedTimelineWindowSignal()));
  readonly headlineStats = computed(() => {
    const latestCurrent = this.latestCurrentDayPoint();
    const latestReal = this.latestRealWorkoutPoint();
    return {
      fitness: {
        value: this.formatRoundedValue(latestCurrent?.ctl),
      },
      fatigue: {
        value: this.formatRoundedValue(latestCurrent?.atl),
      },
      form: {
        value: this.formatRoundedValue(this.selectedFormValue()),
      },
      tss: {
        value: this.formatRoundedValue(latestReal?.trainingStressScore),
      },
    };
  });

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[ChartsFormComponent]',
      mobileTapFeedbackOptions: () => this.mobileTapFeedbackOptions,
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.updateNoDataOverlayState();
    if (!this.chartDiv?.nativeElement) {
      return;
    }

    if (changes.darkTheme || changes.isLoading || changes.formStatus) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  private resolveGranularityLabel(value: DashboardFormTimelineWindow): string {
    return this.granularityOptions.find(option => option.key === value)?.label || 'Week';
  }

  private async refreshChart(): Promise<void> {
    this.updateNoDataOverlayState();
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }

    this.chartHost.hideTooltip();
    const refreshContext = this.buildChartOption();
    this.chartHost.setOption(refreshContext.option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private updateNoDataOverlayState(): void {
    this.noDataErrorMessage = 'No data yet';
    this.noDataErrorHint = 'Needs events with a Training Stress Score';
    this.noDataErrorIcon = 'monitoring';
    if (this.pointsSignal().length > 0) {
      return;
    }
    if (!isDerivedMetricPendingStatus(this.formStatus)) {
      return;
    }
    this.noDataErrorMessage = 'Training metrics are updating';
    this.noDataErrorHint = 'We are recalculating your fitness, fatigue, and form.';
    this.noDataErrorIcon = 'autorenew';
  }

  private buildChartOption(): {
    option: ChartOption;
  } {
    const sourcePoints = this.pointsSignal();
    if (!sourcePoints.length) {
      return {
        option: {
          animation: false,
          tooltip: { show: false },
          xAxis: [],
          yAxis: [],
          series: [],
        },
      };
    }

    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const chartStyle = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const renderTimeInterval = this.resolveRenderTimeInterval(this.selectedTimelineWindowSignal());
    // Keep the trend continuous through today by extending with zero-load decay days.
    const pointsUntilToday = extendDashboardFormPointsWithZeroLoadUntil(sourcePoints, Date.now());
    const points = buildDashboardFormRenderPoints(pointsUntilToday, renderTimeInterval);
    const viewBounds = this.resolveVisibleBounds(points, this.selectedTimelineWindowSignal());
    const labelConfig = resolveDashboardFormXAxisLabelConfig(
      viewBounds.minTime,
      viewBounds.maxTime,
      viewBounds.visiblePointCount,
    );
    const hasSingleVisiblePoint = viewBounds.visiblePointCount <= 1;

    const ctlSeriesValues = points.map(point => [point.time, point.ctl] as const);
    const atlSeriesValues = points.map(point => [point.time, point.atl] as const);
    const formSeriesValues = points.map(point => [point.time, resolveDashboardFormValue(point, ChartsFormComponent.FORM_MODE)] as const);
    const ctlAxisValues = points.map(point => point.ctl);
    const atlAxisValues = points.map(point => point.atl);
    const formAxisValues = points.map(point => resolveDashboardFormValue(point, ChartsFormComponent.FORM_MODE));
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const mobileAxisPointerHandle = isMobileTooltipViewport
      ? {
        show: true,
        size: 20,
        margin: 2,
        throttle: 16,
        color: chartStyle.axisColor,
      }
      : { show: false };

    const topAxisConfig = buildDashboardValueAxisConfig([...ctlAxisValues, ...atlAxisValues]);
    const bottomAxisConfig = buildDashboardValueAxisConfig(
      [...formAxisValues, 0].filter((value): value is number => Number.isFinite(value)),
    );

    const topXAxis = {
      type: 'time',
      min: viewBounds.minTime,
      max: viewBounds.maxTime,
      minInterval: labelConfig.minIntervalMs,
      splitNumber: labelConfig.splitNumber,
      axisPointer: {
        show: true,
        snap: true,
        triggerTooltip: true,
        label: { show: false },
        handle: { show: false },
      },
      axisLabel: { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartStyle.axisColor } },
      splitLine: { show: false },
      boundaryGap: false,
    };

    const bottomXAxis = {
      type: 'time',
      min: viewBounds.minTime,
      max: viewBounds.maxTime,
      minInterval: labelConfig.minIntervalMs,
      splitNumber: labelConfig.splitNumber,
      axisPointer: {
        show: true,
        snap: true,
        triggerTooltip: true,
        label: { show: false },
        handle: mobileAxisPointerHandle,
      },
      axisLabel: {
        show: true,
        color: chartStyle.textColor,
        fontSize: chartStyle.axisFontSize,
        hideOverlap: true,
        margin: isMobileTooltipViewport ? 3 : 8,
        formatter: (value: number) => formatDashboardFormXAxisLabel(Number(value), labelConfig.mode),
        rotate: 0,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartStyle.axisColor } },
      splitLine: { show: false },
      boundaryGap: false,
    };

    const topYAxis = {
      type: 'value',
      min: topAxisConfig.min,
      max: topAxisConfig.max,
      interval: topAxisConfig.interval,
      axisLabel: {
        color: chartStyle.textColor,
        fontSize: chartStyle.axisFontSize,
        formatter: (value: number) => `${Math.round(value)}`,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartStyle.axisColor } },
      splitLine: {
        show: true,
        lineStyle: { color: chartStyle.gridColor },
      },
      axisPointer: {
        show: false,
        label: { show: false },
      },
    };

    const bottomYAxis = {
      type: 'value',
      min: bottomAxisConfig.min,
      max: bottomAxisConfig.max,
      interval: bottomAxisConfig.interval,
      axisLabel: {
        color: chartStyle.textColor,
        fontSize: chartStyle.axisFontSize,
        formatter: (value: number) => `${Math.round(value)}`,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartStyle.axisColor } },
      splitLine: {
        show: true,
        lineStyle: { color: chartStyle.gridColor },
      },
      axisPointer: {
        show: false,
        label: { show: false },
      },
    };

    const gridLeft = chartStyle.isCompactLayout ? 34 : 38;
    const gridRight = chartStyle.isCompactLayout ? 14 : 16;
    const panelHeight = isMobileTooltipViewport ? '36%' : chartStyle.isCompactLayout ? '39%' : '40%';
    const topPanelTop = isMobileTooltipViewport ? '3%' : '4%';
    const bottomPanelTop = isMobileTooltipViewport ? '49%' : chartStyle.isCompactLayout ? '52%' : '51%';

    return {
      option: {
        animation: false,
        backgroundColor: 'transparent',
        textStyle: {
          color: chartStyle.textColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
        },
        grid: [
          {
            left: gridLeft,
            right: gridRight,
            top: topPanelTop,
            height: panelHeight,
            outerBoundsMode: 'none',
          },
          {
            left: gridLeft,
            right: gridRight,
            top: bottomPanelTop,
            height: panelHeight,
            outerBoundsMode: 'none',
          },
        ],
        axisPointer: {
          link: [{ xAxisIndex: [0, 1] }],
          show: true,
          snap: true,
          triggerTooltip: true,
        },
        // Deliberately no ECharts dataZoom/toolbox controls here.
        // Timeline navigation is handled via explicit compact W/M/Y window buttons.
        tooltip: {
          trigger: 'axis',
          triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
          axisPointer: {
            type: 'line',
            axis: 'x',
            snap: true,
          },
          renderMode: 'html',
          show: true,
          confine: true,
          position: (_point: number[], _params: unknown, _dom: unknown, _rect: unknown, size: EChartsTooltipPositionSize) => (
            this.resolveTooltipPosition(size)
          ),
          ...buildDashboardEChartsTooltipChrome(chartStyle),
          formatter: (params: { dataIndex: number }[]) => this.formatTooltip(points, params, renderTimeInterval, chartStyle),
        },
        xAxis: [
          {
            ...topXAxis,
            gridIndex: 0,
          },
          {
            ...bottomXAxis,
            gridIndex: 1,
          },
        ],
        yAxis: [
          {
            ...topYAxis,
            gridIndex: 0,
          },
          {
            ...bottomYAxis,
            gridIndex: 1,
          },
        ],
        series: [
          {
            name: 'Fitness (CTL)',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: ctlSeriesValues,
            smooth: false,
            connectNulls: true,
            symbol: hasSingleVisiblePoint ? 'circle' : 'none',
            symbolSize: hasSingleVisiblePoint ? 4 : 0,
            lineStyle: {
              width: 1.45,
              cap: 'round',
              join: 'round',
              color: chartStyle.trendLineColor,
            },
            itemStyle: {
              color: chartStyle.trendLineColor,
            },
          },
          {
            name: 'Fatigue (ATL)',
            type: 'line',
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: atlSeriesValues,
            smooth: false,
            connectNulls: true,
            symbol: hasSingleVisiblePoint ? 'circle' : 'none',
            symbolSize: hasSingleVisiblePoint ? 4 : 0,
            lineStyle: {
              width: 1.45,
              cap: 'round',
              join: 'round',
              color: FORM_FATIGUE_COLOR,
            },
            itemStyle: {
              color: FORM_FATIGUE_COLOR,
            },
          },
          {
            name: 'Form (TSB)',
            type: 'line',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: formSeriesValues,
            smooth: false,
            connectNulls: false,
            symbol: hasSingleVisiblePoint ? 'circle' : 'none',
            symbolSize: hasSingleVisiblePoint ? 3.5 : 0,
            lineStyle: {
              width: 1.3,
              cap: 'round',
              join: 'round',
              color: chartStyle.secondaryTextColor,
            },
            itemStyle: {
              color: chartStyle.secondaryTextColor,
            },
          },
        ],
      },
    };
  }

  private resolveVisibleBounds(
    points: DashboardFormPoint[],
    window: DashboardFormTimelineWindow,
  ): { minTime: number; maxTime: number; visiblePointCount: number } {
    const firstTime = Number(points[0]?.time);
    const lastTime = Number(points[points.length - 1]?.time);
    if (!Number.isFinite(firstTime) || !Number.isFinite(lastTime) || firstTime > lastTime) {
      return {
        minTime: 0,
        maxTime: 0,
        visiblePointCount: 0,
      };
    }

    const minTime = window === 'y'
      ? firstTime
      : Math.max(firstTime, lastTime - (window === 'm' ? MONTH_VIEW_SPAN_MS : WEEK_VIEW_SPAN_MS));
    const visiblePointCount = points.filter(point => point.time >= minTime && point.time <= lastTime).length;

    return {
      minTime,
      maxTime: lastTime,
      visiblePointCount,
    };
  }

  private resolveRenderTimeInterval(window: DashboardFormTimelineWindow): TimeIntervals {
    if (window === 'm') {
      return TimeIntervals.Weekly;
    }
    if (window === 'y') {
      return TimeIntervals.Monthly;
    }
    return TimeIntervals.Daily;
  }

  private formatTooltip(
    points: DashboardFormPoint[],
    params: { dataIndex: number }[] | undefined,
    renderTimeInterval: TimeIntervals,
    chartStyle: ReturnType<typeof buildDashboardEChartsStyleTokens>,
  ): string {
    if (!Array.isArray(params) || !params.length) {
      return '';
    }

    const index = params[0]?.dataIndex;
    if (!Number.isFinite(index)) {
      return '';
    }

    const point = points[index];
    if (!point) {
      return '';
    }

    const formValue = resolveDashboardFormValue(point, ChartsFormComponent.FORM_MODE);
    const statusTitle = resolveDashboardFormStatus(formValue).title;
    const previousPoint = index > 0 ? points[index - 1] : null;
    const fitnessChange = previousPoint
      ? point.ctl - previousPoint.ctl
      : null;

    const dateLabel = formatDashboardDateByInterval(point.time, renderTimeInterval);
    const statusColor = FORM_FATIGUE_COLOR;

    return renderDashboardEChartsTooltipCard(chartStyle, {
      title: statusTitle,
      titleColor: statusColor,
      subtitle: dateLabel,
      rows: [
        { label: 'Fitness', value: this.formatRoundedValue(point.ctl) },
        { label: 'Fatigue', value: this.formatRoundedValue(point.atl) },
        { label: 'Form', value: this.formatRoundedValue(formValue) },
        { label: 'TSS', value: this.formatRoundedValue(point.trainingStressScore) },
        { label: 'Fitness change', value: this.formatSignedRoundedValue(fitnessChange) },
      ],
    });
  }

  private formatRoundedValue(value: number | null | undefined): string {
    return Number.isFinite(value as number) ? `${Math.round(value as number)}` : '--';
  }

  private formatSignedRoundedValue(value: number | null | undefined): string {
    if (!Number.isFinite(value as number)) {
      return '--';
    }
    const rounded = Math.round(value as number);
    if (rounded > 0) {
      return `+${rounded}`;
    }
    return `${rounded}`;
  }

  private resolveTooltipPosition(size: EChartsTooltipPositionSize): [number, number] {
    const contentWidth = size?.contentSize?.[0] || 320;
    const viewWidth = size?.viewSize?.[0] || contentWidth;
    const horizontalPadding = 8;
    const centeredLeft = (viewWidth - contentWidth) / 2;
    const left = Math.max(horizontalPadding, Math.min(
      centeredLeft,
      viewWidth - contentWidth - horizontalPadding,
    ));
    return [left, 8];
  }
}
