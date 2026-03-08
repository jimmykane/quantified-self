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
import {
  EChartsTooltipSurfaceConfig,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn
} from '../../../../helpers/echarts-tooltip-interaction.helper';
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
type FullscreenHostElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FullscreenCapableDocument = Document & {
  fullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type TooltipFormatterParams = {
  value?: unknown;
  seriesId?: string;
  seriesName?: string;
  color?: string;
};
type PanelSeriesLegendItem = {
  key: string;
  label: string;
  color: string;
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
const ZOOM_BAR_PANEL_HEIGHT = 56; // Keep in sync with .event-chart-panel__chart--zoom-only height.
const ZOOM_BAR_SLIDER_LEFT = 12;
const ZOOM_BAR_SLIDER_RIGHT = 44;
const ZOOM_BAR_SLIDER_TOP = 8;
const ZOOM_BAR_SLIDER_HEIGHT = 24;
const ZOOM_BAR_HANDLE_SIZE = 24;
const ZOOM_BAR_GRID_BOTTOM = Math.max(0, ZOOM_BAR_PANEL_HEIGHT - (ZOOM_BAR_SLIDER_TOP + ZOOM_BAR_SLIDER_HEIGHT));
const SELECTION_BRUSH_SOURCE = 'event-chart-selection-sync';
export const ENABLE_LIVE_SELECTION_SYNC = false;
export const ENABLE_LIVE_SELECTION_PREVIEW_STATS = false;
const TOOLTIP_MAX_DURATION_DISTANCE_SECONDS = 120;
const TOOLTIP_MAX_TIME_DISTANCE_MS = TOOLTIP_MAX_DURATION_DISTANCE_SECONDS * 1000;
const TOOLTIP_MAX_DISTANCE_METERS = 500;

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
  @ViewChild('panelRoot', { static: true }) panelRoot!: ElementRef<HTMLElement>;

  public rangeStats: EventPanelRangeStat[] = [];
  public isFullscreen = false;

  private readonly chartHost: EChartsHostController;
  private eventsBound = false;
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
  private selectionBrushActive = false;
  private chartRefreshSequence: Promise<void> = Promise.resolve();
  private pendingAxisScaleFrame: number | null = null;
  private axisPointerCursorBoundChart: EChartsType | null = null;
  private readonly axisPointerCursorHandler = (params: AxisPointerEvent) => {
    const value = Number(params?.axesInfo?.[0]?.value);
    if (Number.isFinite(value)) {
      this.cursorPositionChange.emit(value);
    }
  };
  private readonly fullscreenChangeHandler = () => {
    this.syncFullscreenState();
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

  public get hasCommittedSelection(): boolean {
    return !!normalizeEventRange(this.selectedRange);
  }

  public get seriesLegendItems(): PanelSeriesLegendItem[] {
    if (!this.showActivityNamesInTooltip || !this.panel?.series?.length) {
      return [];
    }

    const legendItems: PanelSeriesLegendItem[] = [];
    const seenKeys = new Set<string>();
    for (let index = 0; index < this.panel.series.length; index += 1) {
      const series = this.panel.series[index];
      const activityID = `${series.activityID || ''}`.trim();
      const label = `${series.activityName || 'Activity'}`.trim() || 'Activity';
      const key = activityID || label;
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      legendItems.push({
        key,
        label,
        color: series.color,
      });
    }

    return legendItems;
  }

  public get canToggleFullscreen(): boolean {
    if (!this.panel || this.showZoomBar) {
      return false;
    }

    const documentRef = this.getFullscreenDocument();
    const panelElement = this.panelRoot?.nativeElement as FullscreenHostElement | undefined;
    return !!panelElement && (
      typeof panelElement.requestFullscreen === 'function'
      || typeof panelElement.webkitRequestFullscreen === 'function'
      || documentRef.fullscreenEnabled === true
      || documentRef.webkitFullscreenEnabled === true
    );
  }

  public get fullscreenIcon(): string {
    return this.isFullscreen ? 'fullscreen_exit' : 'fullscreen';
  }

  public get fullscreenTooltip(): string {
    return this.isFullscreen ? 'Exit fullscreen' : 'Open panel fullscreen';
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
    this.bindFullscreenEvents();
    this.syncFullscreenState();
    this.bindWheelPassThrough();
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
      || changes.xDomain
      || changes.showLaps
      || changes.lapMarkers
      || changes.emitAxisPointerCursor
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

    const previewRangeChanged = !!changes.previewRange && !changes.previewRange.firstChange;
    const selectedRangeChanged = !!changes.selectedRange && !changes.selectedRange.firstChange;
    const sharedZoomRangeChanged = !!changes.sharedZoomRange && !changes.sharedZoomRange.firstChange;
    const xDomainChanged = !!changes.xDomain && !changes.xDomain.firstChange;
    if (previewRangeChanged || selectedRangeChanged || xDomainChanged) {
      this.applySharedSelectionRange();
      if (selectedRangeChanged || xDomainChanged || (ENABLE_LIVE_SELECTION_PREVIEW_STATS && previewRangeChanged)) {
        this.updateRangeStats(ENABLE_LIVE_SELECTION_PREVIEW_STATS ? this.getActiveSelectionRange() : this.selectedRange);
      }
      this.cdr.markForCheck();
    }

    if (sharedZoomRangeChanged) {
      this.applyStoredZoomRange();
    }
  }

  ngOnDestroy(): void {
    this.cancelPendingFrame('axisScale');
    this.unbindFullscreenEvents();
    this.teardownViewportObserver();
    this.unbindWheelPassThrough();
    this.unbindAxisPointerCursorEmit();
    this.chartHost.dispose();
  }

  public async onFullscreenToggle(): Promise<void> {
    if (!this.canToggleFullscreen) {
      return;
    }

    try {
      if (this.isPanelFullscreen()) {
        await this.exitFullscreen();
      } else {
        await this.enterFullscreen();
      }
    } catch (error) {
      this.logger.error('[EventCardChartPanelComponent] Failed to toggle fullscreen', error);
    }
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
        this.applyStoredZoomRange();
        this.chartHost.scheduleResize();
        this.cdr.markForCheck();
        return;
      }

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
    this.updateRangeStats(this.selectedRange);
    this.applyStoredZoomRange();
    this.chartHost.scheduleResize();
    this.cdr.markForCheck();
  }

  private buildOption(): ChartOption {
    const panel = this.panel as EventChartPanelModel;
    const hoverTooltipEnabled = this.isHoverTooltipEnabled();
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
    });
    const resolvedStrokeWidth = Number(this.strokeWidth);
    const seriesStrokeWidth = Number.isFinite(resolvedStrokeWidth) && resolvedStrokeWidth > 0
      ? resolvedStrokeWidth
      : AppUserUtilities.getDefaultChartStrokeWidth();
    const resolvedFillOpacity = Number(this.fillOpacity);
    const seriesFillOpacity = Number.isFinite(resolvedFillOpacity)
      ? Math.min(1, Math.max(0, resolvedFillOpacity))
      : AppUserUtilities.getDefaultChartFillOpacity();
    const areaFillOrigin: 'start' | 'end' = yAxisConfig.inverse ? 'end' : 'start';
    const tooltipSurfaceConfig = this.buildTooltipSurfaceConfig();
    const tooltipTriggerOn = resolveEChartsTooltipTriggerOn(hoverTooltipEnabled, this.isMobile);

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
        origin: areaFillOrigin,
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
        show: this.tooltipVisibleForViewport && hoverTooltipEnabled,
        triggerOn: tooltipTriggerOn,
        renderMode: 'html',
        ...tooltipSurfaceConfig,
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
      toolbox: {
        show: false,
        feature: {
          // Keep brush feature typed to prevent ECharts from injecting default
          // visible toolbox buttons when brush is enabled.
          brush: {
            type: ['lineX'],
          },
        },
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
      if (!this.applyingSharedZoomRange) {
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
          threshold: [0, TOOLTIP_VIEWPORT_THRESHOLD],
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
    const isVisible = primaryEntry.isIntersecting;
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
        left: ZOOM_BAR_SLIDER_LEFT,
        right: ZOOM_BAR_SLIDER_RIGHT,
        top: ZOOM_BAR_SLIDER_TOP,
        bottom: ZOOM_BAR_GRID_BOTTOM,
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
          left: ZOOM_BAR_SLIDER_LEFT,
          right: ZOOM_BAR_SLIDER_RIGHT,
          top: ZOOM_BAR_SLIDER_TOP,
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

    const xValue = this.getTooltipXAxisValue(tooltipParams);
    if (!Number.isFinite(xValue)) {
      return '';
    }

    const header = formatEventXAxisValue(
      xValue,
      this.xAxisType,
      { includeDateForTime: this.showDateOnTimeAxis }
    );
    const tooltipLines: string[] = [];
    const resolvedPoints = this.resolveTooltipPointsAtX(xValue);
    for (let index = 0; index < resolvedPoints.length; index += 1) {
      const resolvedPoint = resolvedPoints[index];
      const formatted = this.formatDataValue(resolvedPoint.series.streamType || '', resolvedPoint.point.y as number);
      const label = this.showActivityNamesInTooltip ? `${resolvedPoint.series.activityName}: ` : '';
      tooltipLines.push(
        `<div><span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${resolvedPoint.series.color};"></span>${label}${formatted}</div>`
      );
    }

    if (!tooltipLines.length) {
      return '';
    }

    return `<div style="font-weight:600;margin-bottom:4px;">${header}</div>${tooltipLines.join('')}`;
  }

  private getTooltipXAxisValue(params: TooltipFormatterParams[]): number {
    for (let index = 0; index < params.length; index += 1) {
      const point = params[index];
      if (Array.isArray(point?.value) && Number.isFinite(Number(point.value[0]))) {
        return Number(point.value[0]);
      }
    }

    return Number.NaN;
  }

  private resolveTooltipPointsAtX(xValue: number): Array<{ series: PanelSeriesModel; point: EventChartPoint }> {
    if (!this.panel) {
      return [];
    }

    const pixelTolerance = this.getTooltipMaxXDistance();
    const resolvedPoints: Array<{ series: PanelSeriesModel; point: EventChartPoint }> = [];

    for (let index = 0; index < this.panel.series.length; index += 1) {
      const series = this.panel.series[index];
      const nearestPoint = this.findNearestTooltipPoint(series.points, xValue);
      if (!nearestPoint || !Number.isFinite(nearestPoint.point.y)) {
        continue;
      }

      const maxAcceptedDistance = this.getTooltipAcceptedXDistance(series.points, nearestPoint.index, pixelTolerance);
      if (nearestPoint.distance > maxAcceptedDistance) {
        continue;
      }

      resolvedPoints.push({
        series,
        point: nearestPoint.point,
      });
    }

    return resolvedPoints;
  }

  private getTooltipMaxXDistance(): number {
    const domain = this.getActiveDomain();
    const visibleRange = this.sharedZoomRange
      ? clampEventRange(this.sharedZoomRange, domain.start, domain.end) || domain
      : domain;
    const span = Math.max(0, visibleRange.end - visibleRange.start);
    if (!Number.isFinite(span) || span <= 0) {
      return 0;
    }

    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 360;
    const hoverTolerancePixels = this.isMobile ? 24 : 18;
    return (span / Math.max(chartWidth, 1)) * hoverTolerancePixels;
  }

  private findNearestTooltipPoint(
    points: EventChartPoint[],
    xValue: number
  ): { point: EventChartPoint; distance: number; index: number } | null {
    if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(xValue)) {
      return null;
    }

    let low = 0;
    let high = points.length - 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const middleX = Number(points[middle]?.x);
      if (!Number.isFinite(middleX)) {
        return null;
      }

      if (middleX < xValue) {
        low = middle + 1;
      } else if (middleX > xValue) {
        high = middle - 1;
      } else {
        return {
          point: points[middle],
          distance: 0,
          index: middle,
        };
      }
    }

    const candidates = [
      { point: points[Math.max(0, high)], index: Math.max(0, high) },
      { point: points[Math.min(points.length - 1, low)], index: Math.min(points.length - 1, low) }
    ].filter((candidate): candidate is { point: EventChartPoint; index: number } => !!candidate.point && Number.isFinite(candidate.point.x));
    if (!candidates.length) {
      return null;
    }

    let nearestCandidate = candidates[0];
    let nearestDistance = Math.abs(nearestCandidate.point.x - xValue);

    for (let index = 1; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const candidateDistance = Math.abs(candidate.point.x - xValue);
      if (candidateDistance < nearestDistance) {
        nearestCandidate = candidate;
        nearestDistance = candidateDistance;
      }
    }

    return {
      point: nearestCandidate.point,
      distance: nearestDistance,
      index: nearestCandidate.index,
    };
  }

  private getTooltipAcceptedXDistance(
    points: EventChartPoint[],
    pointIndex: number,
    pixelTolerance: number
  ): number {
    const localSpacingBound = this.getTooltipLocalSpacingBound(points, pointIndex);
    const hardCap = this.getTooltipHardDistanceCap();
    return Math.min(pixelTolerance, localSpacingBound, hardCap);
  }

  private getTooltipLocalSpacingBound(points: EventChartPoint[], pointIndex: number): number {
    const point = points[pointIndex];
    if (!point || !Number.isFinite(point.x)) {
      return 0;
    }

    const previousPoint = pointIndex > 0 ? points[pointIndex - 1] : null;
    const nextPoint = pointIndex < points.length - 1 ? points[pointIndex + 1] : null;
    const neighborDistances = [
      previousPoint && Number.isFinite(previousPoint.x) ? Math.abs(point.x - previousPoint.x) : Number.NaN,
      nextPoint && Number.isFinite(nextPoint.x) ? Math.abs(nextPoint.x - point.x) : Number.NaN,
    ].filter((distance) => Number.isFinite(distance) && distance > 0);

    if (!neighborDistances.length) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(...neighborDistances) / 2;
  }

  private getTooltipHardDistanceCap(): number {
    switch (this.xAxisType) {
      case XAxisTypes.Time:
        return TOOLTIP_MAX_TIME_DISTANCE_MS;
      case XAxisTypes.Distance:
        return TOOLTIP_MAX_DISTANCE_METERS;
      case XAxisTypes.Duration:
      default:
        return TOOLTIP_MAX_DURATION_DISTANCE_SECONDS;
    }
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
    if (!this.isHoverTooltipEnabled()) {
      this.hideLocalLapTooltip();
      return;
    }

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
    const tooltipSurfaceConfig = this.buildTooltipSurfaceConfig();

    const showTipAction: ChartAction = {
      type: 'showTip',
      x: offsetX + LAP_TOOLTIP_OFFSET_X,
      y: offsetY + LAP_TOOLTIP_OFFSET_Y,
      escapeConnect: true,
      tooltip: {
        trigger: 'item',
        renderMode: 'html',
        ...tooltipSurfaceConfig,
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
    if (!selectModeActive) {
      this.updateSelectionBrushState(false);
    }

    this.chartHost.setOption({
      tooltip: {
        show: this.tooltipVisibleForViewport && this.isHoverTooltipEnabled(),
        triggerOn: resolveEChartsTooltipTriggerOn(this.isHoverTooltipEnabled(), this.isMobile),
      },
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
      brushOption: {
        brushType: 'lineX',
        brushMode: 'single',
        removeOnClick: true,
      },
    };

    chart.dispatchAction(takeGlobalCursorAction);

    if (this.selectionBrushActive) {
      this.hideLocalLapTooltip();
      this.safeHideTip(chart);
    }

    this.applySharedSelectionRange();
  }

  private handleBrushEvent(params: BrushEventParams): void {
    if (this.showZoomBar || this.cursorBehaviour !== ChartCursorBehaviours.SelectX) {
      return;
    }

    if (this.applyingSharedSelectionRange || params?.$from === SELECTION_BRUSH_SOURCE) {
      return;
    }

    const nextRange = this.extractBrushRange(params);
    this.updateSelectionBrushState(!!nextRange);

    if (!ENABLE_LIVE_SELECTION_SYNC) {
      return;
    }

    const currentRange = this.getActiveSelectionRange();
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
    this.updateSelectionBrushState(false);
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
    if (this.showZoomBar) {
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

  private bindFullscreenEvents(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('webkitfullscreenchange', this.fullscreenChangeHandler as EventListener);
  }

  private unbindFullscreenEvents(): void {
    if (typeof document === 'undefined') {
      return;
    }

    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('webkitfullscreenchange', this.fullscreenChangeHandler as EventListener);
  }

  private syncFullscreenState(): void {
    const nextFullscreenState = this.isPanelFullscreen();
    if (nextFullscreenState === this.isFullscreen) {
      if (nextFullscreenState) {
        this.chartHost.scheduleResize();
      }
      return;
    }

    this.isFullscreen = nextFullscreenState;
    this.chartHost.scheduleResize();
    this.cdr.markForCheck();
  }

  private isPanelFullscreen(): boolean {
    const fullscreenElement = this.getFullscreenElement();
    return !!fullscreenElement && fullscreenElement === this.panelRoot?.nativeElement;
  }

  private getFullscreenElement(): Element | null {
    const documentRef = this.getFullscreenDocument();
    return documentRef.fullscreenElement ?? documentRef.webkitFullscreenElement ?? null;
  }

  private getFullscreenDocument(): FullscreenCapableDocument {
    return document as FullscreenCapableDocument;
  }

  private async enterFullscreen(): Promise<void> {
    const panelElement = this.panelRoot?.nativeElement as FullscreenHostElement | undefined;
    if (!panelElement) {
      return;
    }

    if (typeof panelElement.requestFullscreen === 'function') {
      await panelElement.requestFullscreen();
      return;
    }

    if (typeof panelElement.webkitRequestFullscreen === 'function') {
      await panelElement.webkitRequestFullscreen();
    }
  }

  private async exitFullscreen(): Promise<void> {
    const documentRef = this.getFullscreenDocument();
    if (typeof documentRef.exitFullscreen === 'function') {
      await documentRef.exitFullscreen();
      return;
    }

    if (typeof documentRef.webkitExitFullscreen === 'function') {
      await documentRef.webkitExitFullscreen();
    }
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
    if (ENABLE_LIVE_SELECTION_SYNC) {
      return normalizeEventRange(this.previewRange ?? this.selectedRange);
    }

    return normalizeEventRange(this.selectedRange);
  }

  private isHoverTooltipEnabled(): boolean {
    return !this.selectionBrushActive;
  }

  private updateSelectionBrushState(isActive: boolean): void {
    if (this.selectionBrushActive === isActive) {
      return;
    }

    this.selectionBrushActive = isActive;
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    if (isActive) {
      this.hideLocalLapTooltip();
      this.safeHideTip(chart);
    }

    this.chartHost.setOption({
      tooltip: {
        show: this.tooltipVisibleForViewport && this.isHoverTooltipEnabled(),
        triggerOn: resolveEChartsTooltipTriggerOn(this.isHoverTooltipEnabled(), this.isMobile),
      },
    }, {
      notMerge: false,
      lazyUpdate: true,
      silent: true,
    });
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

  private buildTooltipSurfaceConfig(): EChartsTooltipSurfaceConfig {
    return resolveEChartsTooltipSurfaceConfig(this.isMobile);
  }
}
