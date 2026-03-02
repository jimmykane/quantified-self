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
import { ChartThemes, LapTypes, XAxisTypes } from '@sports-alliance/sports-lib';
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
  formatEventXAxisValue
} from '../../../../helpers/event-echarts-xaxis.helper';
import { buildEventPanelYAxisConfig } from '../../../../helpers/event-echarts-yaxis.helper';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import type { EventChartPoint } from '../../../../helpers/event-echarts-data.helper';
import { AppUserUtilities } from '../../../../utils/app.user.utilities';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type PanelSeriesModel = EventChartPanelModel['series'][number];

const PROGRESSIVE_THRESHOLD = 6000;
const PROGRESSIVE_STEP = 900;
const DATA_ZOOM_THROTTLE_MS = 60;
const FORMATTED_VALUE_CACHE_LIMIT = 600;
const TOOLTIP_VIEWPORT_THRESHOLD = 0.1;
const LAP_TOOLTIP_OFFSET_X = 12;
const LAP_TOOLTIP_OFFSET_Y = 12;
const ZOOM_BAR_SLIDER_HEIGHT = 24;
const ZOOM_BAR_HANDLE_SIZE = 24;
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
  @Input() showDateOnTimeAxis = true;
  @Input() showLaps = true;
  @Input() lapTypes: LapTypes[] = [];
  @Input() lapMarkers: EventChartLapMarker[] = [];
  @Input() extraMaxForPower = 0;
  @Input() extraMaxForPace = -0.25;
  @Input() strokeWidth = AppUserUtilities.getDefaultChartStrokeWidth();
  @Input() showActivityNamesInTooltip = false;
  @Input() zoomBarOverviewData: Array<[number, number]> = [];

  @Output() cursorPositionChange = new EventEmitter<number>();

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

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
  private seriesDataCache = new WeakMap<EventChartPoint[], Array<[number, number]>>();
  private formattedValueCache = new Map<string, string>();
  private activeLapTooltipKey: string | null = null;

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService,
    private cdr: ChangeDetectorRef,
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[EventCardChartPanelComponent]'
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.chartHost.init(this.chartDiv?.nativeElement);
    this.bindWheelPassThrough();
    this.syncNativeZoomGroup();
    this.bindChartEvents();
    this.refreshChart();
    this.syncViewportObserver();
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
      || changes.zoomBarOverviewData
    ) {
      this.refreshChart();
      this.syncViewportObserver();
    }
  }

  ngOnDestroy(): void {
    this.teardownViewportObserver();
    this.unbindWheelPassThrough();
    this.disconnectNativeZoomGroup();
    this.chartHost.dispose();
  }

  private refreshChart(): void {
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    if (!this.panel) {
      this.seriesByID.clear();
      if (this.showZoomBar) {
        this.syncNativeZoomGroup();
        this.chartHost.setOption(this.buildZoomBarOnlyOption(), { notMerge: true, lazyUpdate: true });
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
      this.disconnectNativeZoomGroup();
      this.chartHost.setOption({
        animation: this.useAnimations === true,
        xAxis: [],
        yAxis: [],
        series: []
      }, { notMerge: true, lazyUpdate: true });
      return;
    }

    this.syncNativeZoomGroup();
    this.seriesByID = new Map(this.panel.series.map((series) => [series.id, series]));
    this.chartHost.setOption(this.buildOption(), ECHARTS_INTERACTIVE_CARTESIAN_MERGE_UPDATE_SETTINGS);
    this.applyCanonicalXAxisScale();
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
    const yAxisConfig = buildEventPanelYAxisConfig({
      panel,
      visibleRange: null,
      extraMaxForPower: this.extraMaxForPower,
      extraMaxForPace: this.extraMaxForPace,
    });
    const resolvedStrokeWidth = Number(this.strokeWidth);
    const seriesStrokeWidth = Number.isFinite(resolvedStrokeWidth) && resolvedStrokeWidth > 0
      ? resolvedStrokeWidth
      : AppUserUtilities.getDefaultChartStrokeWidth();

    const seriesOptions: any[] = panel.series.map((series) => ({
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
      data: this.getSeriesLineData(series.points)
    }));

    if (seriesOptions[0]) {
      seriesOptions[0].markLine = this.buildLapMarkLine(darkTheme);
    }

    const hasPaceSeries = panel.series.some((series) => /pace/i.test(series.streamType));

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
        inverse: yAxisConfig.inverse || hasPaceSeries,
        min: yAxisConfig.min,
        max: yAxisConfig.max,
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
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
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

  private shouldDisplayLapMarker(marker: EventChartLapMarker): boolean {
    return isEventLapTypeAllowed(marker.lapType, this.lapTypes);
  }

  private bindChartEvents(): void {
    const chart = this.chartHost.getChart();
    if (!chart || this.eventsBound || !this.panel) {
      return;
    }

    if (!TEMP_DISABLE_AXIS_POINTER_CURSOR_EMIT) {
      chart.on('updateAxisPointer', (params: any) => {
        const value = Number(params?.axesInfo?.[0]?.value);
        if (Number.isFinite(value)) {
          this.cursorPositionChange.emit(value);
        }
      });
    }

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

    chart.on('datazoom', () => {
      this.applyCanonicalXAxisScale();
    });

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

    this.viewportVisible = isVisible;
    this.applyViewportAnimationMode(isVisible);
    if (this.showZoomBar) {
      this.applyZoomBarVisibilityForViewport(isVisible);
      return;
    }

    this.applyZoomSyncVisibilityForViewport(isVisible);
    this.applyTooltipVisibilityForViewport(isVisible);
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
          right: 12,
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
          data: overviewData
        }
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
      const yValue = Number(Array.isArray(point.value) ? point.value[1] : point.value);
      const formatted = this.formatDataValue(streamType || '', yValue);
      const label = this.showActivityNamesInTooltip ? `${point.seriesName}: ` : '';
      tooltipLines.push(
        `<div><span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${point.color};"></span>${label}${formatted}</div>`
      );
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

    chart.dispatchAction({
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
      } as any,
    } as any);
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

    chart.dispatchAction({
      type: 'hideTip',
      escapeConnect: true,
    } as any);
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

  private getSeriesLineData(points: EventChartPoint[]): Array<[number, number]> {
    const pointsRef = points as EventChartPoint[];
    const cachedData = this.seriesDataCache.get(pointsRef);
    if (cachedData) {
      return cachedData;
    }

    const data = new Array<[number, number]>(points.length);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      data[index] = [point.x, point.y];
    }

    this.seriesDataCache.set(pointsRef, data);
    return data;
  }
}
