import {
  AfterViewInit,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { ChartCursorBehaviours, LapTypes, XAxisTypes } from '@sports-alliance/sports-lib';
import type { ECElementEvent, EChartsType } from 'echarts/core';
import { AppBreakpoints } from '../../../../constants/breakpoints';
import { EChartsLoaderService } from '../../../../services/echarts-loader.service';
import { LoggerService } from '../../../../services/logger.service';
import {
  ECHARTS_INTERACTIVE_CARTESIAN_MERGE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../../helpers/echarts-host-controller';
import { getOrCreateEChartsTooltipHost } from '../../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../../helpers/echarts-tooltip-position.helper';
import {
  EventChartLapMarker,
  EventChartPanelModel,
} from '../../../../helpers/event-echarts-data.helper';
import { isEventLapTypeAllowed } from '../../../../helpers/event-lap-type.helper';
import {
  buildEventCanonicalXAxisScaleOptions,
  EventChartRange,
  clampEventRange,
  formatEventXAxisValue,
  formatDurationSeconds,
  normalizeEventRange,
} from '../../../../helpers/event-echarts-xaxis.helper';
import { buildEventPanelYAxisConfig } from '../../../../helpers/event-echarts-yaxis.helper';
import {
  computeEventPanelRangeStats,
  EventPanelRangeStat,
} from '../../../../helpers/event-echarts-range-stats.helper';
import { buildEventEChartsVisualTokens } from '../../../../helpers/event-echarts-common.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../../helpers/echarts-theme.helper';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import type { EventChartPoint } from '../../../../helpers/event-echarts-data.helper';
import { AppUserUtilities } from '../../../../utils/app.user.utilities';
import type { LineSeriesOption } from 'echarts/charts';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type ChartAction = Parameters<EChartsType['dispatchAction']>[0];
type PanelSeriesModel = EventChartPanelModel['series'][number];
type ChartLineSeriesOption = LineSeriesOption;
type TooltipFormatterParams = {
  value?: unknown;
  seriesId?: string;
  seriesName?: string;
  color?: string;
};
type AxisPointerEvent = {
  axesInfo?: Array<{
    value?: number | string;
  }>;
};
type BrushAreaPayload = {
  coordRange?: [number, number] | number[];
  coordRanges?: Array<[number, number] | number[]>;
};
type BrushEventParams = {
  $from?: string;
  areas?: BrushAreaPayload[];
};

const PROGRESSIVE_THRESHOLD = 6000;
const PROGRESSIVE_STEP = 900;
const DATA_ZOOM_THROTTLE_MS = 60;
const FORMATTED_VALUE_CACHE_LIMIT = 600;
const TOOLTIP_VIEWPORT_THRESHOLD = 0.1;
const LAP_TOOLTIP_OFFSET_X = 12;
const LAP_TOOLTIP_OFFSET_Y = 12;
const ZOOM_BAR_SLIDER_HEIGHT = 24;
const ZOOM_BAR_HANDLE_SIZE = 24;
const SELECTION_BRUSH_SOURCE = 'event-chart-selection-sync';
const PREVIEW_RANGE_STATS_THROTTLE_MS = 66;

@Component({
  selector: 'app-event-card-chart-panel',
  templateUrl: './event.card.chart.panel.component.html',
  styleUrls: ['./event.card.chart.panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventCardChartPanelComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() panel: EventChartPanelModel | null = null;
  @Input() xAxisType: XAxisTypes = XAxisTypes.Duration;
  @Input() darkTheme = false;
  @Input() useAnimations = false;
  @Input() showZoomBar = false;
  @Input() zoomGroupId: string | null = null;
  @Input() xDomain: EventChartRange | null = null;
  @Input() cursorBehaviour: ChartCursorBehaviours = ChartCursorBehaviours.ZoomX;
  @Input() previewRange: EventChartRange | null = null;
  @Input() selectedRange: EventChartRange | null = null;
  @Input() showDateOnTimeAxis = true;
  @Input() showLaps = true;
  @Input() lapTypes: LapTypes[] = [];
  @Input() lapMarkers: EventChartLapMarker[] = [];
  @Input() emitAxisPointerCursor = false;
  @Input() gainAndLossThreshold = AppUserUtilities.getDefaultGainAndLossThreshold();
  @Input() extraMaxForPower = 0;
  @Input() extraMaxForPace = -0.25;
  @Input() strokeWidth = AppUserUtilities.getDefaultChartStrokeWidth();
  @Input() fillOpacity = AppUserUtilities.getDefaultChartFillOpacity();
  @Input() waterMark = '';
  @Input() showActivityNamesInTooltip = false;
  @Input() zoomBarOverviewData: Array<[number, number]> = [];
  @Input() sharedZoomRange: EventChartRange | null = null;

  @Output() cursorPositionChange = new EventEmitter<number>();
  @Output() previewRangeChange = new EventEmitter<EventChartRange | null>();
  @Output() selectedRangeChange = new EventEmitter<EventChartRange | null>();
  @Output() zoomRangeChange = new EventEmitter<EventChartRange | null>();

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  public rangeStats: EventPanelRangeStat[] = [];

  private readonly chartHost: EChartsHostController;
  private eventsBound = false;
  private connectedZoomGroupId: string | null = null;
  private wheelPassThroughListener: ((event: Event) => void) | null = null;
  private viewportObserver: IntersectionObserver | null = null;
  private viewportVisible = true;
  private tooltipVisibleForViewport = true;
  private zoomBarVisibleForViewport = true;
  private zoomSyncVisibleForViewport = true;
  private seriesByID = new Map<string, PanelSeriesModel>();
  private seriesDataCache = new WeakMap<EventChartPoint[], Array<[number, number | null]>>();
  private formattedValueCache = new Map<string, string>();
  private activeLapTooltipKey: string | null = null;
  private applyingSharedSelectionRange = false;
  private applyingSharedZoomRange = false;
  private chartRefreshSequence: Promise<void> = Promise.resolve();
  private pendingAxisScaleFrame: number | null = null;
  private previewStatsTimer: ReturnType<typeof setTimeout> | null = null;
  private axisPointerCursorBoundChart: EChartsType | null = null;
  private readonly axisPointerCursorHandler = (params: AxisPointerEvent) => {
    const value = Number(params?.axesInfo?.[0]?.value);
    if (Number.isFinite(value)) {
      this.cursorPositionChange.emit(value);
    }
  };

  private get isMobile(): boolean {
    return typeof window !== 'undefined' && window.matchMedia(AppBreakpoints.XSmall).matches;
  }

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
    private cdr: ChangeDetectorRef,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[EventCardChartPanelComponent]',
      initOptions: {
        useDirtyRect: true,
      },
    });
  }

  public get hasSelection(): boolean {
    return !!this.getActiveSelectionRange();
  }

  public get selectedRangeStartLabel(): string {
    const normalizedRange = this.getActiveSelectionRange();
    if (!normalizedRange) {
      return '';
    }

    return formatEventXAxisValue(
      normalizedRange.start,
      this.xAxisType,
      { includeDateForTime: this.showDateOnTimeAxis }
    );
  }

  public get selectedRangeEndLabel(): string {
    const normalizedRange = this.getActiveSelectionRange();
    if (!normalizedRange) {
      return '';
    }

    return formatEventXAxisValue(
      normalizedRange.end,
      this.xAxisType,
      { includeDateForTime: this.showDateOnTimeAxis }
    );
  }

  public get selectedRangeSpanLabel(): string {
    const normalizedRange = this.getActiveSelectionRange();
    if (!normalizedRange) {
      return '';
    }

    const span = normalizedRange.end - normalizedRange.start;
    if (!Number.isFinite(span) || span < 0) {
      return '';
    }

    switch (this.xAxisType) {
      case XAxisTypes.Time:
        return formatDurationSeconds(span / 1000);
      case XAxisTypes.Distance:
        return formatEventXAxisValue(span, XAxisTypes.Distance);
      case XAxisTypes.Duration:
      default:
        return formatDurationSeconds(span);
    }
  }

  public getRangeStatEntries(stat: EventPanelRangeStat): Array<{ label: string; value: string }> {
    const entries = [
      { label: 'Min', value: `${stat.min.value}${stat.min.unit}` },
      { label: 'Avg', value: `${stat.avg.value}${stat.avg.unit}` },
      { label: 'Max', value: `${stat.max.value}${stat.max.unit}` },
    ];

    if (stat.gain) {
      entries.push({ label: 'Gain', value: `${stat.gain.value}${stat.gain.unit}` });
    }
    if (stat.loss) {
      entries.push({ label: 'Loss', value: `${stat.loss.value}${stat.loss.unit}` });
    }
    if (stat.slope) {
      entries.push({ label: 'Slope', value: stat.slope });
    }

    return entries;
  }

  async ngAfterViewInit(): Promise<void> {
    await this.chartHost.init(this.chartDiv?.nativeElement, resolveEChartsThemeName(this.darkTheme));
    this.bindWheelPassThrough();
    this.syncNativeZoomGroup();
    this.bindChartEvents();
    this.queueChartRefresh('ngAfterViewInit');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartHost.getChart()) {
      return;
    }

    if (
      changes.panel
      || changes.xAxisType
      || changes.darkTheme
      || changes.useAnimations
      || changes.showZoomBar
      || changes.zoomGroupId
      || changes.xDomain
      || changes.showLaps
      || changes.lapMarkers
      || changes.emitAxisPointerCursor
      || changes.extraMaxForPower
      || changes.extraMaxForPace
      || changes.strokeWidth
      || changes.fillOpacity
      || changes.waterMark
      || changes.zoomBarOverviewData
    ) {
      this.queueChartRefresh('ngOnChanges');
    }

    if (changes.cursorBehaviour && !changes.cursorBehaviour.firstChange) {
      this.syncInteractionMode();
    }

    if (
      (changes.emitAxisPointerCursor && !changes.emitAxisPointerCursor.firstChange)
      || (changes.panel && !changes.panel.firstChange)
    ) {
      this.syncAxisPointerCursorEmitBinding();
    }

    if (
      (changes.previewRange && !changes.previewRange.firstChange)
      || (changes.selectedRange && !changes.selectedRange.firstChange)
      || (changes.xDomain && !changes.xDomain.firstChange)
    ) {
      this.applySharedSelectionRange();
      this.syncRangeStatsWithSelection();
      this.cdr.markForCheck();
    }

    if (changes.sharedZoomRange && !changes.sharedZoomRange.firstChange && this.showZoomBar) {
      this.applyStoredZoomRange();
    }
  }

  ngOnDestroy(): void {
    this.cancelPendingFrame('axisScale');
    this.clearPreviewStatsTimer();
    this.teardownViewportObserver();
    this.unbindWheelPassThrough();
    this.unbindAxisPointerCursorEmit();
    this.disconnectNativeZoomGroup();
    this.chartHost.dispose();
  }

  private queueChartRefresh(source: string): void {
    this.chartRefreshSequence = this.chartRefreshSequence
      .then(async () => {
        await this.chartHost.init(this.chartDiv?.nativeElement, resolveEChartsThemeName(this.darkTheme));
        this.refreshChart();
        this.syncViewportObserver();
      })
      .catch((error) => {
        this.logger.error('[EventCardChartPanelComponent] Failed to queue chart refresh', {
          source,
          error,
        });
      });
  }

  private refreshChart(): void {
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    if (!this.panel) {
      this.seriesByID.clear();
      this.rangeStats = [];
      if (this.showZoomBar) {
        this.chartHost.setOption(this.buildZoomBarOnlyOption(), { notMerge: true, lazyUpdate: true });
        this.syncAxisPointerCursorEmitBinding();
        this.syncNativeZoomGroup();
        this.chartHost.scheduleResize();
        this.cdr.markForCheck();
        return;
      }

      this.disconnectNativeZoomGroup();
      this.syncAxisPointerCursorEmitBinding();
      this.chartHost.setOption({
        animation: this.useAnimations === true,
        xAxis: [],
        yAxis: [],
        series: []
      }, { notMerge: true, lazyUpdate: true });
      return;
    }

    if (!this.panel.series.length) {
      this.seriesByID.clear();
      this.rangeStats = [];
      this.disconnectNativeZoomGroup();
      this.syncAxisPointerCursorEmitBinding();
      this.chartHost.setOption({
        animation: this.useAnimations === true,
        xAxis: [],
        yAxis: [],
        series: []
      }, { notMerge: true, lazyUpdate: true });
      return;
    }

    this.seriesByID = new Map(this.panel.series.map((series) => [series.id, series]));
    this.chartHost.setOption(this.buildOption(), ECHARTS_INTERACTIVE_CARTESIAN_MERGE_UPDATE_SETTINGS);
    this.syncAxisPointerCursorEmitBinding();
    this.applyCanonicalAxisScales();
    this.syncInteractionMode();
    this.applySharedSelectionRange();
    this.syncRangeStatsWithSelection();
    this.syncNativeZoomGroup();
    this.chartHost.scheduleResize();
    this.cdr.markForCheck();
  }

  private buildOption(): ChartOption {
    const panel = this.panel as EventChartPanelModel;
    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme, this.isMobile);
    const textColor = chartStyle.textColor;
    const axisLabelColor = textColor;
    const axisColor = this.darkTheme ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)';
    const gridColor = chartStyle.gridColor;
    const axisLabelFontSize = chartStyle.axisLabelFontSize;
    const tooltipBackgroundColor = chartStyle.tooltipBackgroundColor;
    const tooltipBorderColor = chartStyle.tooltipBorderColor;
    const domain = this.getActiveDomain();
    const visibleRange = this.getVisibleXAxisRange();
    const yAxisConfig = buildEventPanelYAxisConfig({
      panel,
      visibleRange,
      extraMaxForPower: this.extraMaxForPower,
      extraMaxForPace: this.extraMaxForPace,
    });
    const resolvedStrokeWidth = Number(this.strokeWidth);
    const seriesStrokeWidth = Number.isFinite(resolvedStrokeWidth) && resolvedStrokeWidth > 0
      ? resolvedStrokeWidth
      : AppUserUtilities.getDefaultChartStrokeWidth();
    const resolvedFillOpacity = Number(this.fillOpacity);
    const seriesFillOpacity = Number.isFinite(resolvedFillOpacity)
      ? Math.min(1, Math.max(0, resolvedFillOpacity))
      : AppUserUtilities.getDefaultChartFillOpacity();

    const seriesOptions: ChartLineSeriesOption[] = panel.series.map((series) => ({
      id: series.id,
      name: series.activityName,
      type: 'line',
      smooth: false,
      showSymbol: false,
      symbolSize: 5,
      progressive: series.points.length >= PROGRESSIVE_THRESHOLD ? PROGRESSIVE_STEP : 0,
      progressiveThreshold: PROGRESSIVE_THRESHOLD,
      progressiveChunkMode: 'mod',
      animation: this.useAnimations === true,
      lineStyle: {
        width: seriesStrokeWidth,
        color: series.color,
      },
      itemStyle: {
        color: series.color,
      },
      areaStyle: {
        color: series.color,
        opacity: seriesFillOpacity,
      },
      emphasis: {
        disabled: true,
      },
      data: this.getSeriesLineData(series.points),
    }));

    if (seriesOptions[0]) {
      seriesOptions[0].markLine = this.buildLapMarkLine(chartStyle);
    }

    return {
      animation: this.useAnimations === true,
      animationThreshold: PROGRESSIVE_THRESHOLD,
      backgroundColor: 'transparent',
      textStyle: {
        color: textColor,
        fontFamily: ECHARTS_GLOBAL_FONT_FAMILY
      },
      grid: {
        left: 0,
        right: 0,
        top: 8,
        bottom: 16,
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        show: this.tooltipVisibleForViewport,
        triggerOn: 'mousemove|click',
        renderMode: 'html',
        appendTo: getOrCreateEChartsTooltipHost,
        confine: this.isMobile,
        position: getViewportConstrainedTooltipPosition,
        axisPointer: {
          type: 'line',
          animation: false
        },
        transitionDuration: 0,
        backgroundColor: tooltipBackgroundColor,
        borderColor: tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: 12,
        },
        formatter: (params: TooltipFormatterParams | TooltipFormatterParams[]) => this.formatTooltip(params)
      },
      brush: this.buildBrushOption(chartStyle),
      xAxis: {
        ...(buildEventCanonicalXAxisScaleOptions(this.xAxisType, domain) || {}),
        type: this.xAxisType === XAxisTypes.Time ? 'time' : 'value',
        min: domain.start,
        max: domain.end,
        axisLine: {
          lineStyle: { color: axisColor }
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          color: axisLabelColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: axisLabelFontSize,
          margin: this.isMobile ? 10 : 12,
          formatter: (value: number) => formatEventXAxisValue(
            Number(value),
            this.xAxisType,
            { includeDateForTime: this.showDateOnTimeAxis }
          )
        }
      },
      yAxis: {
        type: 'value',
        inverse: yAxisConfig.inverse,
        min: yAxisConfig.min,
        max: yAxisConfig.max,
        interval: yAxisConfig.interval,
        axisLine: {
          lineStyle: { color: axisColor }
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: gridColor,
            width: 1,
          }
        },
        axisLabel: {
          color: axisLabelColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: axisLabelFontSize,
          margin: this.isMobile ? 8 : 10,
          formatter: (value: number) => this.formatDataValue(panel.dataType, value, false)
        }
      },
      graphic: this.buildWatermarkGraphic(chartStyle),
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          disabled: this.cursorBehaviour === ChartCursorBehaviours.SelectX,
          filterMode: 'filter',
          throttle: DATA_ZOOM_THROTTLE_MS,
          zoomOnMouseWheel: false,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          preventDefaultMouseMove: false,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          show: this.showZoomBar,
          height: 16,
          top: 8,
          filterMode: 'filter',
          showDataShadow: false,
          throttle: DATA_ZOOM_THROTTLE_MS,
        }
      ],
      series: seriesOptions
    } as ChartOption;
  }

  private buildWatermarkGraphic(chartStyle: ReturnType<typeof buildEventEChartsVisualTokens>): Record<string, unknown>[] {
    const waterMarkText = `${this.waterMark || ''}`.trim();
    if (!waterMarkText || this.showZoomBar) {
      return [];
    }

    return [
      {
        type: 'text',
        right: 8,
        top: 10,
        silent: true,
        z: 0,
        style: {
          text: waterMarkText,
          fill: chartStyle.watermarkColor,
          font: '600 16px "Barlow Condensed", sans-serif',
          textAlign: 'right',
          textVerticalAlign: 'top',
        },
      }
    ];
  }

  private buildLapMarkLine(chartStyle: ReturnType<typeof buildEventEChartsVisualTokens>): Record<string, unknown> {
    const visibleLapMarkers = this.showLaps
      ? this.lapMarkers.filter((marker) => this.shouldDisplayLapMarker(marker))
      : [];

    return {
      symbol: 'none',
      silent: false,
      animation: false,
      label: {
        show: false,
      },
      tooltip: {
        show: false,
      },
      lineStyle: {
        type: 'dashed',
        width: 1,
        color: chartStyle.lapLineColor,
      },
      data: this.showLaps
        ? visibleLapMarkers
          .map((marker) => ({
            xAxis: marker.xValue,
            xValue: marker.xValue,
            name: marker.label,
            value: marker.xValue,
            lapNumber: marker.lapNumber,
            lapType: marker.lapType,
            tooltipTitle: marker.tooltipTitle,
            tooltipDetails: marker.tooltipDetails,
            lineStyle: {
              color: marker.color,
              type: 'dashed',
              width: 1,
              opacity: 0.45,
            },
          }))
        : []
    };
  }

  private buildBrushOption(chartStyle: ReturnType<typeof buildEventEChartsVisualTokens>): Record<string, unknown> {
    return {
      toolbox: [],
      brushLink: 'none',
      xAxisIndex: 0,
      brushMode: 'single',
      transformable: false,
      removeOnClick: true,
      throttleType: 'fixRate',
      throttleDelay: DATA_ZOOM_THROTTLE_MS,
      brushStyle: {
        color: chartStyle.brushFillColor,
        borderColor: chartStyle.brushBorderColor,
        borderWidth: 1,
      }
    };
  }

  private shouldDisplayLapMarker(marker: EventChartLapMarker): boolean {
    return isEventLapTypeAllowed(marker.lapType, this.lapTypes);
  }

  private bindChartEvents(): void {
    const chart = this.chartHost.getChart();
    if (!chart || this.eventsBound || (!this.panel && !this.showZoomBar)) {
      return;
    }

    if (this.panel) {
      chart.on('mousemove', (params: ECElementEvent) => {
        if (params?.componentType === 'markLine') {
          this.showLocalLapTooltip(params);
          return;
        }

        this.hideLocalLapTooltip();
      });

      chart.on('globalout', () => {
        this.hideLocalLapTooltip();
      });
    }

    chart.on('datazoom', () => {
      if (this.panel) {
        this.scheduleCanonicalAxisScaleUpdate();
      }
      if (this.showZoomBar && !this.applyingSharedZoomRange) {
        this.emitVisibleZoomRange();
      }
    });

    if (this.panel) {
      chart.on('brush', (params: BrushEventParams) => {
        this.handleBrushEvent(params);
      });
      chart.on('brushEnd', (params: BrushEventParams) => {
        this.handleBrushEnd(params);
      });
    }

    this.eventsBound = true;
  }

  private syncAxisPointerCursorEmitBinding(): void {
    const chart = this.chartHost.getChart();
    const shouldEmitAxisPointerCursor = !!this.panel && this.emitAxisPointerCursor;

    if (this.axisPointerCursorBoundChart && (this.axisPointerCursorBoundChart !== chart || !shouldEmitAxisPointerCursor)) {
      this.axisPointerCursorBoundChart.off('updateAxisPointer', this.axisPointerCursorHandler);
      this.axisPointerCursorBoundChart = null;
    }

    if (!chart || !shouldEmitAxisPointerCursor || this.axisPointerCursorBoundChart === chart) {
      return;
    }

    chart.on('updateAxisPointer', this.axisPointerCursorHandler);
    this.axisPointerCursorBoundChart = chart;
  }

  private unbindAxisPointerCursorEmit(): void {
    if (!this.axisPointerCursorBoundChart) {
      return;
    }

    this.axisPointerCursorBoundChart.off('updateAxisPointer', this.axisPointerCursorHandler);
    this.axisPointerCursorBoundChart = null;
  }

  private syncViewportObserver(): void {
    const chart = this.chartHost.getChart();
    const container = this.chartDiv?.nativeElement;
    if (!chart || !container) {
      return;
    }

    if (!this.shouldObserveViewportVisibility()) {
      this.teardownViewportObserver();
      this.viewportVisible = true;
      this.tooltipVisibleForViewport = true;
      this.zoomBarVisibleForViewport = true;
      this.zoomSyncVisibleForViewport = true;
      this.syncNativeZoomGroup();
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      this.viewportVisible = true;
      this.applyTooltipVisibilityForViewport(true);
      this.applyZoomBarVisibilityForViewport(true);
      this.applyZoomSyncVisibilityForViewport(true);
      this.applyViewportAnimationMode(true);
      return;
    }

    if (!this.viewportObserver) {
      const observerRoot = this.resolveViewportObserverRoot(container);
      this.viewportObserver = new IntersectionObserver(
        (entries) => this.handleViewportEntries(entries),
        {
          root: observerRoot,
          threshold: [TOOLTIP_VIEWPORT_THRESHOLD],
        }
      );
      this.viewportObserver.observe(container);
    }
  }

  private shouldObserveViewportVisibility(): boolean {
    if (this.showZoomBar) {
      return true;
    }

    return !!this.panel;
  }

  private teardownViewportObserver(): void {
    if (!this.viewportObserver) {
      return;
    }

    this.viewportObserver.disconnect();
    this.viewportObserver = null;
  }

  private handleViewportEntries(entries: IntersectionObserverEntry[]): void {
    if (!entries.length) {
      return;
    }

    const primaryEntry = entries[0];
    const isVisible = primaryEntry.isIntersecting && primaryEntry.intersectionRatio >= TOOLTIP_VIEWPORT_THRESHOLD;
    if (this.viewportVisible === isVisible) {
      return;
    }

    this.viewportVisible = isVisible;
    this.applyViewportAnimationMode(isVisible);
    if (this.showZoomBar) {
      this.applyZoomBarVisibilityForViewport(isVisible);
      return;
    }

    this.applyZoomSyncVisibilityForViewport(isVisible);
    this.applyTooltipVisibilityForViewport(isVisible);
    if (isVisible) {
      this.applyStoredZoomRange();
    }
  }

  private resolveViewportObserverRoot(container: HTMLElement): Element | Document | null {
    let current: HTMLElement | null = container.parentElement;
    while (current) {
      try {
        const computedStyle = getComputedStyle(current);
        const overflowY = `${computedStyle.overflowY || ''}`.toLowerCase();
        const overflow = `${computedStyle.overflow || ''}`.toLowerCase();
        if (
          overflowY === 'auto'
          || overflowY === 'scroll'
          || overflowY === 'overlay'
          || overflow === 'auto'
          || overflow === 'scroll'
          || overflow === 'overlay'
        ) {
          return current;
        }
      } catch {
        // Ignore style lookup failures and keep walking up.
      }
      current = current.parentElement;
    }

    return null;
  }

  private applyTooltipVisibilityForViewport(isVisible: boolean): void {
    if (this.tooltipVisibleForViewport === isVisible) {
      return;
    }

    this.tooltipVisibleForViewport = isVisible;
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    if (!isVisible) {
      this.safeHideTip(chart);
    }

    this.chartHost.setOption({
      tooltip: {
        show: isVisible,
      },
    }, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });
  }

  private applyZoomSyncVisibilityForViewport(isVisible: boolean): void {
    if (this.zoomSyncVisibleForViewport === isVisible) {
      return;
    }

    this.zoomSyncVisibleForViewport = isVisible;
    this.syncNativeZoomGroup();
  }

  private applyZoomBarVisibilityForViewport(isVisible: boolean): void {
    if (this.zoomBarVisibleForViewport === isVisible) {
      return;
    }

    this.zoomBarVisibleForViewport = isVisible;
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    this.chartHost.setOption({
      dataZoom: [
        { show: isVisible }
      ],
    }, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });
  }

  private safeHideTip(chart: EChartsType): void {
    try {
      chart.dispatchAction({ type: 'hideTip' });
    } catch (error) {
      this.logger.warn('[EventCardChartPanelComponent] Failed to hide tooltip for offscreen panel', error);
    }
  }

  private applyViewportAnimationMode(isVisible: boolean): void {
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    this.chartHost.setOption({
      animation: isVisible ? (this.useAnimations === true) : false,
      animationDurationUpdate: isVisible ? undefined : 0,
    }, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });
  }

  private buildZoomBarOnlyOption(): ChartOption {
    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme, this.isMobile);
    const axisColor = chartStyle.axisColor;
    const sliderTrackColor = chartStyle.dataZoomTrackColor;
    const sliderSelectionColor = chartStyle.dataZoomSelectionColor;
    const sliderHandleColor = chartStyle.dataZoomHandleColor;
    const overviewLineColor = chartStyle.dataZoomOverviewLineColor;
    const overviewFillColor = chartStyle.dataZoomOverviewFillColor;
    const domain = this.getActiveDomain();
    const overviewData = this.zoomBarOverviewData.length > 0
      ? this.zoomBarOverviewData
      : [
        [domain.start, 0],
        [domain.end, 0],
      ];

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: {
        left: 0,
        right: 0,
        top: 2,
        bottom: 2,
        containLabel: false
      },
      tooltip: { show: false },
      xAxis: {
        type: this.xAxisType === XAxisTypes.Time ? 'time' : 'value',
        min: domain.start,
        max: domain.end,
        show: false
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        show: false
      },
      dataZoom: [
        {
          type: 'slider',
          xAxisIndex: 0,
          show: this.zoomBarVisibleForViewport,
          left: 12,
          right: 44,
          top: 8,
          height: ZOOM_BAR_SLIDER_HEIGHT,
          filterMode: 'filter',
          showDataShadow: true,
          showDetail: true,
          labelFormatter: (value: number) => formatEventXAxisValue(
            Number(value),
            this.xAxisType,
            { includeDateForTime: this.showDateOnTimeAxis }
          ),
          handleSize: ZOOM_BAR_HANDLE_SIZE,
          borderColor: axisColor,
          backgroundColor: sliderTrackColor,
          fillerColor: sliderSelectionColor,
          dataBackground: {
            lineStyle: {
              color: overviewLineColor,
              width: 1,
            },
            areaStyle: {
              color: overviewFillColor,
            }
          },
          selectedDataBackground: {
            lineStyle: {
              color: overviewLineColor,
              width: 1.2,
            },
            areaStyle: {
              color: overviewFillColor,
            }
          },
          textStyle: {
            color: chartStyle.textColor,
            fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          },
          handleStyle: {
            color: sliderHandleColor,
            borderColor: axisColor,
            borderWidth: 1,
            shadowBlur: 4,
            shadowColor: chartStyle.emphasisShadowColor,
          },
          moveHandleStyle: {
            color: sliderSelectionColor
          },
          emphasis: {
            moveHandleStyle: {
              color: sliderSelectionColor
            }
          },
        }
      ],
      series: [
        {
          type: 'line',
          silent: true,
          symbol: 'none',
          animation: false,
          lineStyle: {
            color: overviewLineColor,
            width: 1,
            opacity: 0,
          },
          areaStyle: {
            color: overviewFillColor,
            opacity: 0,
          },
          data: overviewData,
          markLine: this.buildLapMarkLine(chartStyle),
        } satisfies ChartLineSeriesOption
      ]
    } as ChartOption;
  }

  private formatTooltip(params: TooltipFormatterParams | TooltipFormatterParams[]): string {
    const tooltipParams = Array.isArray(params) ? params : [params];
    if (!this.panel || tooltipParams.length === 0) {
      return '';
    }

    const xValue = Number(Array.isArray(tooltipParams[0]?.value) ? tooltipParams[0].value[0] : undefined);
    const header = formatEventXAxisValue(
      xValue,
      this.xAxisType,
      { includeDateForTime: this.showDateOnTimeAxis }
    );
    const tooltipLines: string[] = [];
    for (let index = 0; index < tooltipParams.length; index += 1) {
      const point = tooltipParams[index];
      const seriesModel = this.seriesByID.get(point.seriesId);
      const streamType = seriesModel?.streamType || this.panel?.dataType;
      const rawYValue = Array.isArray(point.value) ? point.value[1] : point.value;
      if (rawYValue === null || rawYValue === undefined || rawYValue === '') {
        continue;
      }
      const yValue = Number(rawYValue);
      if (!Number.isFinite(yValue)) {
        continue;
      }
      const formatted = this.formatDataValue(streamType || '', yValue);
      const label = this.showActivityNamesInTooltip ? `${point.seriesName}: ` : '';
      tooltipLines.push(
        `<div><span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${point.color};"></span>${label}${formatted}</div>`
      );
    }

    if (!tooltipLines.length) {
      return '';
    }

    return `<div style="font-weight:600;margin-bottom:4px;">${header}</div>${tooltipLines.join('')}`;
  }

  private formatLapMarkerTooltip(params: any): string {
    const marker = params?.data as EventChartLapMarker | undefined;
    if (!marker && !params) {
      return '';
    }

    const lapTitle = `${marker?.tooltipTitle || params?.name || marker?.label || `Lap ${marker?.lapNumber || ''}`}`.trim();
    const lines = [`<div style="font-weight:600;margin-bottom:4px;">${lapTitle}</div>`];
    const detailRows = Array.isArray(marker?.tooltipDetails) ? marker.tooltipDetails : [];

    for (let index = 0; index < detailRows.length; index += 1) {
      const row = detailRows[index];
      if (!row?.label || !row?.value) {
        continue;
      }
      lines.push(`<div>${row.label}: ${row.value}</div>`);
    }

    return lines.join('');
  }

  private showLocalLapTooltip(params: ECElementEvent): void {
    const chart = this.chartHost.getChart();
    const marker = params?.data as EventChartLapMarker | undefined;
    const offsetX = Number(params?.event?.offsetX);
    const offsetY = Number(params?.event?.offsetY);
    if (!chart || !marker || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      return;
    }

    const tooltipKey = `${marker.lapNumber}|${marker.xValue}`;
    this.activeLapTooltipKey = tooltipKey;

    const chartStyle = buildEventEChartsVisualTokens(this.darkTheme, this.isMobile);
    const tooltipHtml = this.formatLapMarkerTooltip({ data: marker, name: marker.label });

    const showTipAction: ChartAction = {
      type: 'showTip',
      x: offsetX + LAP_TOOLTIP_OFFSET_X,
      y: offsetY + LAP_TOOLTIP_OFFSET_Y,
      escapeConnect: true,
      tooltip: {
        trigger: 'item',
        renderMode: 'html',
        appendTo: getOrCreateEChartsTooltipHost,
        confine: this.isMobile,
        position: getViewportConstrainedTooltipPosition,
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: 12,
        },
        formatter: () => tooltipHtml,
      },
    };

    chart.dispatchAction(showTipAction);
  }

  private hideLocalLapTooltip(): void {
    if (!this.activeLapTooltipKey) {
      return;
    }

    const chart = this.chartHost.getChart();
    this.activeLapTooltipKey = null;
    if (!chart) {
      return;
    }

    const hideTipAction: ChartAction = {
      type: 'hideTip',
      escapeConnect: true,
    };

    chart.dispatchAction(hideTipAction);
  }

  private scheduleCanonicalAxisScaleUpdate(): void {
    if (this.pendingAxisScaleFrame !== null) {
      return;
    }

    this.pendingAxisScaleFrame = this.requestFrame(() => {
      this.pendingAxisScaleFrame = null;
      this.applyCanonicalAxisScales();
    });
  }

  private applyCanonicalAxisScales(): void {
    if (!this.panel) {
      return;
    }

    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    const scaleOptions = buildEventCanonicalXAxisScaleOptions(this.xAxisType, this.getVisibleXAxisRange());
    const yAxisConfig = buildEventPanelYAxisConfig({
      panel: this.panel,
      visibleRange: this.getVisibleXAxisRange(),
      extraMaxForPower: this.extraMaxForPower,
      extraMaxForPace: this.extraMaxForPace,
    });

    this.chartHost.setOption({
      ...(scaleOptions ? { xAxis: scaleOptions } : {}),
      yAxis: {
        inverse: yAxisConfig.inverse,
        min: yAxisConfig.min,
        max: yAxisConfig.max,
        interval: yAxisConfig.interval,
      },
    }, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });
  }

  private syncInteractionMode(): void {
    if (this.showZoomBar) {
      return;
    }

    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    const selectModeActive = this.cursorBehaviour === ChartCursorBehaviours.SelectX;

    this.chartHost.setOption({
      dataZoom: [
        {
          disabled: selectModeActive,
        }
      ],
    }, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });

    const takeGlobalCursorAction: ChartAction = {
      type: 'takeGlobalCursor',
      key: 'brush',
      brushOption: selectModeActive
        ? {
          brushType: 'lineX',
          brushMode: 'single',
          removeOnClick: true,
        }
        : {
          brushType: 'lineX',
          brushMode: 'single',
          removeOnClick: true,
        },
    };

    chart.dispatchAction(takeGlobalCursorAction);

    if (!selectModeActive) {
      this.applySharedSelectionRange();
    }
  }

  private handleBrushEvent(params: BrushEventParams): void {
    if (this.showZoomBar || this.cursorBehaviour !== ChartCursorBehaviours.SelectX) {
      return;
    }

    if (this.applyingSharedSelectionRange || params?.$from === SELECTION_BRUSH_SOURCE) {
      return;
    }

    const nextRange = this.extractBrushRange(params);
    const currentRange = normalizeEventRange(this.selectedRange);
    if (
      currentRange?.start === nextRange?.start
      && currentRange?.end === nextRange?.end
    ) {
      return;
    }

    this.previewRangeChange.emit(nextRange);
  }

  private handleBrushEnd(params: BrushEventParams): void {
    if (this.showZoomBar) {
      return;
    }

    if (params?.$from === SELECTION_BRUSH_SOURCE) {
      return;
    }

    const nextRange = this.extractBrushRange(params);
    if (this.cursorBehaviour === ChartCursorBehaviours.SelectX) {
      this.previewRangeChange.emit(nextRange);
      this.selectedRangeChange.emit(nextRange);
      return;
    }

    if (this.cursorBehaviour !== ChartCursorBehaviours.ZoomX) {
      return;
    }

    this.clearSelectionOverlay();
    if (!nextRange) {
      return;
    }

    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    this.previewRangeChange.emit(nextRange);
    this.zoomRangeChange.emit(this.normalizeZoomRange(nextRange));
    const dataZoomAction: ChartAction = {
      type: 'dataZoom',
      startValue: nextRange.start,
      endValue: nextRange.end,
    };

    chart.dispatchAction(dataZoomAction);
  }

  private applySharedSelectionRange(): void {
    if (this.showZoomBar || this.cursorBehaviour !== ChartCursorBehaviours.SelectX) {
      this.clearSelectionOverlay();
      return;
    }

    const chart = this.chartHost.getChart();
    const domain = this.getActiveDomain();
    const activeRange = this.getActiveSelectionRange();
    if (!chart) {
      return;
    }

    const nextRange = activeRange
      ? clampEventRange(activeRange, domain.start, domain.end)
      : null;

    this.applyingSharedSelectionRange = true;
    try {
      const brushAction: ChartAction = {
        type: 'brush',
        areas: nextRange ? [this.buildBrushArea(nextRange)] : [],
        $from: SELECTION_BRUSH_SOURCE,
      };

      chart.dispatchAction(brushAction);
    } finally {
      this.applyingSharedSelectionRange = false;
    }
  }

  private syncRangeStatsWithSelection(): void {
    if (this.previewRange) {
      this.schedulePreviewStatsUpdate();
      return;
    }

    this.clearPreviewStatsTimer();
    this.updateRangeStats(this.selectedRange);
  }

  private schedulePreviewStatsUpdate(): void {
    if (this.previewStatsTimer !== null) {
      return;
    }

    this.previewStatsTimer = setTimeout(() => {
      this.previewStatsTimer = null;
      this.updateRangeStats(this.previewRange);
      this.cdr.markForCheck();
    }, PREVIEW_RANGE_STATS_THROTTLE_MS);
  }

  private clearPreviewStatsTimer(): void {
    if (this.previewStatsTimer === null) {
      return;
    }

    clearTimeout(this.previewStatsTimer);
    this.previewStatsTimer = null;
  }

  private updateRangeStats(range: EventChartRange | null): void {
    if (!this.panel || !this.panel.series.length) {
      this.rangeStats = [];
      return;
    }

    this.rangeStats = computeEventPanelRangeStats({
      panel: this.panel,
      range,
      xAxisType: this.xAxisType,
      gainAndLossThreshold: this.gainAndLossThreshold,
    });
  }

  private clearSelectionOverlay(): void {
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    this.applyingSharedSelectionRange = true;
    try {
      const clearBrushAction: ChartAction = {
        type: 'brush',
        areas: [],
        $from: SELECTION_BRUSH_SOURCE,
      };

      chart.dispatchAction(clearBrushAction);
    } finally {
      this.applyingSharedSelectionRange = false;
    }
  }

  private buildBrushArea(range: EventChartRange): Record<string, unknown> {
    return {
      brushType: 'lineX',
      xAxisIndex: 0,
      coordRange: [range.start, range.end],
    };
  }

  private extractBrushRange(params: BrushEventParams): EventChartRange | null {
    const rawAreas = Array.isArray(params?.areas) ? params.areas : [];
    const firstArea = rawAreas[0];
    if (!firstArea) {
      return null;
    }

    const coordRange = Array.isArray(firstArea.coordRange)
      ? firstArea.coordRange
      : Array.isArray(firstArea.coordRanges?.[0])
        ? firstArea.coordRanges[0]
        : null;
    if (!coordRange || coordRange.length < 2) {
      return null;
    }

    const domain = this.getActiveDomain();
    return clampEventRange(
      {
        start: Number(coordRange[0]),
        end: Number(coordRange[1]),
      },
      domain.start,
      domain.end
    );
  }

  private formatDataValue(streamType: string, value: number, includeUnit = true): string {
    if (!Number.isFinite(value)) {
      return '--';
    }

    const cacheKey = `${streamType}|${includeUnit ? 1 : 0}|${value}`;
    const cachedValue = this.formattedValueCache.get(cacheKey);
    if (cachedValue !== undefined) {
      return cachedValue;
    }

    let formattedValue: string;
    try {
      const dataInstance = DynamicDataLoader.getDataInstanceFromDataType(streamType, value);
      formattedValue = includeUnit
        ? `${dataInstance.getDisplayValue()}${dataInstance.getDisplayUnit()}`
        : `${dataInstance.getDisplayValue()}`;
    } catch {
      formattedValue = `${value.toFixed(2)}`;
    }

    this.formattedValueCache.set(cacheKey, formattedValue);
    if (this.formattedValueCache.size > FORMATTED_VALUE_CACHE_LIMIT) {
      const oldestKey = this.formattedValueCache.keys().next().value as string | undefined;
      if (oldestKey) {
        this.formattedValueCache.delete(oldestKey);
      }
    }

    return formattedValue;
  }

  private syncNativeZoomGroup(): void {
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    const requestedGroupId = `${this.zoomGroupId || ''}`.trim() || null;
    const hasRenderableSeries = Array.isArray(this.panel?.series) && this.panel.series.length > 0;
    const hasRenderableChart = this.showZoomBar || hasRenderableSeries;
    const shouldJoinZoomGroup = hasRenderableChart && (this.showZoomBar || this.zoomSyncVisibleForViewport);
    const nextGroupId = shouldJoinZoomGroup ? requestedGroupId : null;
    if (this.connectedZoomGroupId === nextGroupId) {
      return;
    }

    const previousGroupId = this.connectedZoomGroupId;
    if (!previousGroupId && nextGroupId) {
      this.applyStoredZoomRange();
    }
    chart.group = nextGroupId || undefined;
    this.connectedZoomGroupId = nextGroupId;
    if (previousGroupId && previousGroupId !== nextGroupId) {
      void this.eChartsLoader.disconnectGroup(previousGroupId);
    }
    if (nextGroupId) {
      void this.eChartsLoader.connectGroup(nextGroupId);
    }
  }

  private disconnectNativeZoomGroup(): void {
    const chart = this.chartHost.getChart();
    if (chart?.group) {
      chart.group = undefined;
    }

    if (!this.connectedZoomGroupId) {
      return;
    }
    void this.eChartsLoader.disconnectGroup(this.connectedZoomGroupId);
    this.connectedZoomGroupId = null;
  }

  private bindWheelPassThrough(): void {
    const container = this.chartDiv?.nativeElement;
    if (!container || this.wheelPassThroughListener) {
      return;
    }

    // Keep page scrolling natural when wheel is over the chart area.
    this.wheelPassThroughListener = (event: Event) => {
      event.stopPropagation();
    };
    container.addEventListener('wheel', this.wheelPassThroughListener, { capture: true, passive: true });
  }

  private unbindWheelPassThrough(): void {
    const container = this.chartDiv?.nativeElement;
    if (!container || !this.wheelPassThroughListener) {
      return;
    }
    container.removeEventListener('wheel', this.wheelPassThroughListener, { capture: true });
    this.wheelPassThroughListener = null;
  }

  private getActiveDomain(): EventChartRange {
    const normalizedDomain = this.xDomain
      ? clampEventRange(this.xDomain, this.xDomain.start, this.xDomain.end)
      : null;

    if (normalizedDomain) {
      return normalizedDomain;
    }

    const panelMin = Number(this.panel?.minX);
    const panelMax = Number(this.panel?.maxX);
    if (Number.isFinite(panelMin) && Number.isFinite(panelMax) && panelMax > panelMin) {
      return {
        start: panelMin,
        end: panelMax,
      };
    }

    return {
      start: 0,
      end: 1,
    };
  }

  private getVisibleXAxisRange(): EventChartRange {
    const domain = this.getActiveDomain();
    const chart = this.chartHost.getChart();
    const chartOption = chart?.getOption?.();
    const dataZoomOption = Array.isArray(chartOption?.dataZoom) ? chartOption.dataZoom[0] : null;

    const startValue = Number(dataZoomOption?.startValue);
    const endValue = Number(dataZoomOption?.endValue);
    if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
      return clampEventRange({ start: startValue, end: endValue }, domain.start, domain.end) || domain;
    }

    const startPercent = Number(dataZoomOption?.start);
    const endPercent = Number(dataZoomOption?.end);
    if (Number.isFinite(startPercent) && Number.isFinite(endPercent)) {
      const domainSpan = domain.end - domain.start;
      return clampEventRange({
        start: domain.start + (domainSpan * startPercent) / 100,
        end: domain.start + (domainSpan * endPercent) / 100,
      }, domain.start, domain.end) || domain;
    }

    return domain;
  }

  private getActiveSelectionRange(): EventChartRange | null {
    return normalizeEventRange(this.previewRange ?? this.selectedRange);
  }

  private emitVisibleZoomRange(): void {
    this.zoomRangeChange.emit(this.normalizeZoomRange(this.getVisibleXAxisRange()));
  }

  private normalizeZoomRange(range: EventChartRange | null): EventChartRange | null {
    const domain = this.getActiveDomain();
    const clampedRange = range ? clampEventRange(range, domain.start, domain.end) : null;
    if (!clampedRange) {
      return null;
    }

    return clampedRange.start === domain.start && clampedRange.end === domain.end
      ? null
      : clampedRange;
  }

  private applyStoredZoomRange(): void {
    const chart = this.chartHost.getChart();
    if (!chart || (!this.showZoomBar && !this.zoomSyncVisibleForViewport)) {
      return;
    }

    const normalizedRange = this.normalizeZoomRange(this.sharedZoomRange);
    const currentRange = this.normalizeZoomRange(this.getVisibleXAxisRange());
    if (
      currentRange?.start === normalizedRange?.start
      && currentRange?.end === normalizedRange?.end
    ) {
      return;
    }

    const domain = this.getActiveDomain();
    const targetRange = normalizedRange ?? domain;

    this.applyingSharedZoomRange = true;
    try {
      const syncZoomAction: ChartAction = {
        type: 'dataZoom',
        startValue: targetRange.start,
        endValue: targetRange.end,
      };

      chart.dispatchAction(syncZoomAction);
    } finally {
      this.applyingSharedZoomRange = false;
    }
  }

  private getSeriesLineData(points: EventChartPoint[]): Array<[number, number | null]> {
    const pointsRef = points as EventChartPoint[];
    const cachedData = this.seriesDataCache.get(pointsRef);
    if (cachedData) {
      return cachedData;
    }

    const data = new Array<[number, number | null]>(points.length);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      data[index] = [point.x, point.y];
    }

    this.seriesDataCache.set(pointsRef, data);
    return data;
  }

  private requestFrame(callback: () => void): number {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame(callback);
    }

    return globalThis.setTimeout(callback, 16) as unknown as number;
  }

  private cancelPendingFrame(target: 'axisScale'): void {
    const handle = this.pendingAxisScaleFrame;
    if (handle === null) {
      return;
    }

    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(handle);
    } else {
      globalThis.clearTimeout(handle);
    }

    this.pendingAxisScaleFrame = null;
  }
}
