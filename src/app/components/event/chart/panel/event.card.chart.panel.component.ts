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
import { ChartCursorBehaviours, ChartThemes, LapTypes, XAxisTypes } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import { EChartsLoaderService } from '../../../../services/echarts-loader.service';
import { LoggerService } from '../../../../services/logger.service';
import {
  ECHARTS_INTERACTIVE_CARTESIAN_MERGE_UPDATE_SETTINGS,
  EChartsHostController
} from '../../../../helpers/echarts-host-controller';
import { isDarkChartThemeActive } from '../../../../helpers/echarts-theme.helper';
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
  normalizeEventRange,
} from '../../../../helpers/event-echarts-xaxis.helper';
import { buildEventPanelYAxisConfig } from '../../../../helpers/event-echarts-yaxis.helper';
import {
  computeEventPanelRangeStats,
  EventPanelRangeStat,
} from '../../../../helpers/event-echarts-range-stats.helper';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import type { EventChartPoint } from '../../../../helpers/event-echarts-data.helper';
import { AppUserUtilities } from '../../../../utils/app.user.utilities';
import type { LineSeriesOption } from 'echarts/charts';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type ChartAction = Parameters<EChartsType['dispatchAction']>[0];
type PanelSeriesModel = EventChartPanelModel['series'][number];
type ChartLineSeriesOption = LineSeriesOption;

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
// Temporary perf toggle: disable axis-pointer -> map cursor emission path.
const TEMP_DISABLE_AXIS_POINTER_CURSOR_EMIT = true;

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
  @Input() chartTheme: ChartThemes | string = ChartThemes.Material;
  @Input() useAnimations = false;
  @Input() showZoomBar = false;
  @Input() zoomGroupId: string | null = null;
  @Input() xDomain: EventChartRange | null = null;
  @Input() cursorBehaviour: ChartCursorBehaviours = ChartCursorBehaviours.ZoomX;
  @Input() selectedRange: EventChartRange | null = null;
  @Input() showDateOnTimeAxis = true;
  @Input() showLaps = true;
  @Input() lapTypes: LapTypes[] = [];
  @Input() lapMarkers: EventChartLapMarker[] = [];
  @Input() gainAndLossThreshold = AppUserUtilities.getDefaultGainAndLossThreshold();
  @Input() extraMaxForPower = 0;
  @Input() extraMaxForPace = -0.25;
  @Input() strokeWidth = AppUserUtilities.getDefaultChartStrokeWidth();
  @Input() waterMark = '';
  @Input() showActivityNamesInTooltip = false;
  @Input() zoomBarOverviewData: Array<[number, number]> = [];
  @Input() sharedZoomRange: EventChartRange | null = null;

  @Output() cursorPositionChange = new EventEmitter<number>();
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
    return !!normalizeEventRange(this.selectedRange);
  }

  public get selectedRangeLabel(): string {
    const normalizedRange = normalizeEventRange(this.selectedRange);
    if (!normalizedRange) {
      return '';
    }

    const startLabel = formatEventXAxisValue(
      normalizedRange.start,
      this.xAxisType,
      { includeDateForTime: this.showDateOnTimeAxis }
    );
    const endLabel = formatEventXAxisValue(
      normalizedRange.end,
      this.xAxisType,
      { includeDateForTime: this.showDateOnTimeAxis }
    );

    return `${startLabel} - ${endLabel}`;
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
    await this.chartHost.init(this.chartDiv?.nativeElement);
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
      || changes.chartTheme
      || changes.useAnimations
      || changes.showZoomBar
      || changes.zoomGroupId
      || changes.xDomain
      || changes.showLaps
      || changes.lapMarkers
      || changes.extraMaxForPower
      || changes.extraMaxForPace
      || changes.strokeWidth
      || changes.waterMark
      || changes.zoomBarOverviewData
    ) {
      this.queueChartRefresh('ngOnChanges');
    }

    if (changes.cursorBehaviour && !changes.cursorBehaviour.firstChange) {
      this.syncInteractionMode();
    }

    if (
      (changes.selectedRange && !changes.selectedRange.firstChange)
      || (changes.xDomain && !changes.xDomain.firstChange)
    ) {
      this.applySharedSelectionRange();
      this.updateRangeStats();
      this.cdr.markForCheck();
    }

    if (changes.sharedZoomRange && !changes.sharedZoomRange.firstChange && this.showZoomBar) {
      this.applyStoredZoomRange();
    }
  }

  ngOnDestroy(): void {
    this.teardownViewportObserver();
    this.unbindWheelPassThrough();
    this.disconnectNativeZoomGroup();
    this.chartHost.dispose();
  }

  private queueChartRefresh(source: string): void {
    this.chartRefreshSequence = this.chartRefreshSequence
      .then(() => {
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
        this.syncNativeZoomGroup();
        this.chartHost.scheduleResize();
        this.cdr.markForCheck();
        return;
      }

      this.disconnectNativeZoomGroup();
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
    this.applyCanonicalXAxisScale();
    this.syncInteractionMode();
    this.applySharedSelectionRange();
    this.updateRangeStats();
    this.syncNativeZoomGroup();
    this.chartHost.scheduleResize();
    this.cdr.markForCheck();
  }

  private buildOption(): ChartOption {
    const panel = this.panel as EventChartPanelModel;
    const darkTheme = isDarkChartThemeActive(this.chartTheme);
    const textColor = darkTheme ? '#f5f5f5' : '#1f1f1f';
    const axisColor = darkTheme ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)';
    const gridColor = darkTheme ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
    const tooltipBackgroundColor = darkTheme ? '#303030' : '#ffffff';
    const tooltipBorderColor = darkTheme ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
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
      emphasis: {
        disabled: true,
      },
      data: this.getSeriesLineData(series.points),
    }));

    if (seriesOptions[0]) {
      seriesOptions[0].markLine = this.buildLapMarkLine(darkTheme);
    }

    return {
      animation: this.useAnimations === true,
      animationThreshold: PROGRESSIVE_THRESHOLD,
      backgroundColor: 'transparent',
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif"
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
        axisPointer: {
          type: 'line',
          animation: false
        },
        transitionDuration: 0,
        backgroundColor: tooltipBackgroundColor,
        borderColor: tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: 12,
        },
        formatter: (params: any) => this.formatTooltip(params)
      },
      brush: this.buildBrushOption(darkTheme),
      xAxis: {
        ...(buildEventCanonicalXAxisScaleOptions(this.xAxisType, domain) || {}),
        type: this.xAxisType === XAxisTypes.Time ? 'time' : 'value',
        min: domain.start,
        max: domain.end,
        axisLine: {
          lineStyle: { color: axisColor }
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          color: textColor,
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
        splitLine: {
          show: true,
          lineStyle: { color: gridColor }
        },
        axisLabel: {
          color: textColor,
          formatter: (value: number) => this.formatDataValue(panel.dataType, value, false)
        }
      },
      graphic: this.buildWatermarkGraphic(darkTheme),
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

  private buildWatermarkGraphic(darkTheme: boolean): Record<string, unknown>[] {
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
          fill: darkTheme ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)',
          font: '600 16px "Barlow Condensed", sans-serif',
          textAlign: 'right',
          textVerticalAlign: 'top',
        },
      }
    ];
  }

  private buildLapMarkLine(darkTheme: boolean): Record<string, unknown> {
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
        color: darkTheme ? 'rgba(255,255,255,0.26)' : 'rgba(0,0,0,0.30)',
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

  private buildBrushOption(darkTheme: boolean): Record<string, unknown> {
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
        color: darkTheme ? 'rgba(144,202,249,0.16)' : 'rgba(25,118,210,0.14)',
        borderColor: darkTheme ? 'rgba(144,202,249,0.72)' : 'rgba(25,118,210,0.68)',
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

    if (this.panel && !TEMP_DISABLE_AXIS_POINTER_CURSOR_EMIT) {
      chart.on('updateAxisPointer', (params: any) => {
        const value = Number(params?.axesInfo?.[0]?.value);
        if (Number.isFinite(value)) {
          this.cursorPositionChange.emit(value);
        }
      });
    }

    if (this.panel) {
      chart.on('mousemove', (params: any) => {
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
        this.applyCanonicalXAxisScale();
        this.applyCanonicalYAxisScale();
      }
      if (this.showZoomBar && !this.applyingSharedZoomRange) {
        this.emitVisibleZoomRange();
      }
    });

    if (this.panel) {
      chart.on('brush', (params: any) => {
        this.handleBrushEvent(params);
      });
      chart.on('brushEnd', (params: any) => {
        this.handleBrushEnd(params);
      });
    }

    this.eventsBound = true;
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

    this.logZoomDebug('viewport-change', {
      intersectionRatio: primaryEntry.intersectionRatio,
      isIntersecting: primaryEntry.isIntersecting,
      nextVisible: isVisible,
      previousVisible: this.viewportVisible,
      zoomSyncVisibleForViewport: this.zoomSyncVisibleForViewport,
    });

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

    this.logZoomDebug('zoom-sync-visibility', {
      nextVisible: isVisible,
      previousVisible: this.zoomSyncVisibleForViewport,
    });
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
    const darkTheme = isDarkChartThemeActive(this.chartTheme);
    const axisColor = darkTheme ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)';
    const sliderTrackColor = darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const sliderSelectionColor = darkTheme ? 'rgba(144,202,249,0.30)' : 'rgba(25,118,210,0.22)';
    const sliderHandleColor = darkTheme ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.45)';
    const overviewLineColor = darkTheme ? 'rgba(144,202,249,0.78)' : 'rgba(25,118,210,0.70)';
    const overviewFillColor = darkTheme ? 'rgba(144,202,249,0.18)' : 'rgba(25,118,210,0.12)';
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
            color: darkTheme ? '#f5f5f5' : '#1f1f1f',
            fontFamily: "'Barlow Condensed', sans-serif",
          },
          handleStyle: {
            color: sliderHandleColor,
            borderColor: axisColor,
            borderWidth: 1,
            shadowBlur: 4,
            shadowColor: darkTheme ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.18)',
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
          markLine: this.buildLapMarkLine(darkTheme),
        } satisfies ChartLineSeriesOption
      ]
    } as ChartOption;
  }

  private formatTooltip(params: any): string {
    if (!this.panel || !Array.isArray(params) || params.length === 0) {
      return '';
    }

    const xValue = Number(params[0]?.value?.[0]);
    const header = formatEventXAxisValue(
      xValue,
      this.xAxisType,
      { includeDateForTime: this.showDateOnTimeAxis }
    );
    const tooltipLines: string[] = [];
    for (let index = 0; index < params.length; index += 1) {
      const point = params[index];
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

  private showLocalLapTooltip(params: any): void {
    const chart = this.chartHost.getChart();
    const marker = params?.data as EventChartLapMarker | undefined;
    const offsetX = Number(params?.event?.offsetX);
    const offsetY = Number(params?.event?.offsetY);
    if (!chart || !marker || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      return;
    }

    const tooltipKey = `${marker.lapNumber}|${marker.xValue}`;
    this.activeLapTooltipKey = tooltipKey;

    const darkTheme = isDarkChartThemeActive(this.chartTheme);
    const textColor = darkTheme ? '#f5f5f5' : '#1f1f1f';
    const tooltipBackgroundColor = darkTheme ? '#303030' : '#ffffff';
    const tooltipBorderColor = darkTheme ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
    const tooltipHtml = this.formatLapMarkerTooltip({ data: marker, name: marker.label });

    const showTipAction: ChartAction = {
      type: 'showTip',
      x: offsetX + LAP_TOOLTIP_OFFSET_X,
      y: offsetY + LAP_TOOLTIP_OFFSET_Y,
      escapeConnect: true,
      tooltip: {
        trigger: 'item',
        backgroundColor: tooltipBackgroundColor,
        borderColor: tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: textColor,
          fontFamily: "'Barlow Condensed', sans-serif",
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

  private applyCanonicalXAxisScale(): void {
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    const scaleOptions = buildEventCanonicalXAxisScaleOptions(this.xAxisType, this.getVisibleXAxisRange());
    if (!scaleOptions) {
      return;
    }

    this.chartHost.setOption({
      xAxis: scaleOptions,
    }, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });
  }

  private applyCanonicalYAxisScale(): void {
    if (!this.panel) {
      return;
    }

    const yAxisConfig = buildEventPanelYAxisConfig({
      panel: this.panel,
      visibleRange: this.getVisibleXAxisRange(),
      extraMaxForPower: this.extraMaxForPower,
      extraMaxForPace: this.extraMaxForPace,
    });

    this.chartHost.setOption({
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

  private handleBrushEvent(params: any): void {
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

    this.selectedRangeChange.emit(nextRange);
  }

  private handleBrushEnd(params: any): void {
    if (this.showZoomBar || this.cursorBehaviour !== ChartCursorBehaviours.ZoomX) {
      return;
    }

    if (params?.$from === SELECTION_BRUSH_SOURCE) {
      return;
    }

    const nextRange = this.extractBrushRange(params);
    this.clearSelectionOverlay();
    if (!nextRange) {
      return;
    }

    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

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
    if (!chart) {
      return;
    }

    const nextRange = this.selectedRange
      ? clampEventRange(this.selectedRange, domain.start, domain.end)
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

  private updateRangeStats(): void {
    if (!this.panel || !this.panel.series.length) {
      this.rangeStats = [];
      return;
    }

    this.rangeStats = computeEventPanelRangeStats({
      panel: this.panel,
      range: this.selectedRange,
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

  private extractBrushRange(params: any): EventChartRange | null {
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

    this.logZoomDebug('sync-native-zoom-group', {
      requestedGroupId,
      previousGroupId: this.connectedZoomGroupId,
      nextGroupId,
      hasRenderableChart,
      showZoomBar: this.showZoomBar,
      zoomSyncVisibleForViewport: this.zoomSyncVisibleForViewport,
      viewportVisible: this.viewportVisible,
    });
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

  private logZoomDebug(source: string, extra?: Record<string, unknown>): void {
    this.logger.info('[EventCardChartPanelComponent] Zoom debug', {
      source,
      showZoomBar: this.showZoomBar,
      panelDataType: this.panel?.displayName || this.panel?.dataType || null,
      panelSeriesCount: this.panel?.series?.length ?? 0,
      zoomGroupId: this.zoomGroupId,
      ...extra,
    });
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
}
