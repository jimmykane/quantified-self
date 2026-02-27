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
  EventChartPanelModel
} from '../../../../helpers/event-echarts-data.helper';
import {
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

  @Output() cursorPositionChange = new EventEmitter<number>();

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private eventsBound = false;
  private connectedZoomGroupId: string | null = null;
  private wheelPassThroughListener: ((event: Event) => void) | null = null;
  private pointerSyncEnabled = false;
  private seriesByID = new Map<string, PanelSeriesModel>();
  private seriesDataCache = new WeakMap<EventChartPoint[], Array<[number, number]>>();

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
    ) {
      this.refreshChart();
    }
  }

  ngOnDestroy(): void {
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

    if (this.showLaps && this.lapMarkers.length > 0 && seriesOptions[0]) {
      seriesOptions[0].markLine = {
        symbol: 'none',
        silent: true,
        animation: false,
        lineStyle: {
          type: 'dashed',
          width: 1,
          color: darkTheme ? 'rgba(255,255,255,0.26)' : 'rgba(0,0,0,0.30)',
        },
        label: {
          show: true,
          color: textColor,
          fontSize: 10,
          formatter: (params: any) => `${params?.data?.name || ''}`,
        },
        data: this.lapMarkers
          .filter((marker) => this.shouldDisplayLapMarker(marker))
          .map((marker) => ({
            xAxis: marker.xValue,
            name: marker.label,
            lineStyle: {
              color: marker.color,
              type: 'dashed',
              width: 1,
              opacity: 0.45,
            },
          }))
      };
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
        triggerOn: this.pointerSyncEnabled ? 'mousemove|click' : 'none',
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
          filterMode: 'none',
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
          filterMode: 'none',
          showDataShadow: false,
          throttle: DATA_ZOOM_THROTTLE_MS,
        }
      ],
      series: seriesOptions
    } as ChartOption;
  }

  private shouldDisplayLapMarker(marker: EventChartLapMarker): boolean {
    if (!this.lapTypes || this.lapTypes.length === 0) {
      return true;
    }
    return this.lapTypes.map((lapType) => `${lapType}`).includes(marker.lapType);
  }

  private bindChartEvents(): void {
    const chart = this.chartHost.getChart();
    if (!chart || this.eventsBound || !this.panel) {
      return;
    }

    if (!TEMP_DISABLE_AXIS_POINTER_CURSOR_EMIT) {
      chart.on('updateAxisPointer', (params: any) => {
        if (!this.pointerSyncEnabled) {
          return;
        }
        const value = Number(params?.axesInfo?.[0]?.value);
        if (Number.isFinite(value)) {
          this.cursorPositionChange.emit(value);
        }
      });
    }

    chart.on('click', () => this.activatePointerSync());
    const zr = (chart as any).getZr?.();
    zr?.on?.('click', () => this.activatePointerSync());

    this.eventsBound = true;
  }

  private activatePointerSync(): void {
    if (this.pointerSyncEnabled) {
      return;
    }
    this.pointerSyncEnabled = true;
    this.chartHost.setOption({
      tooltip: {
        triggerOn: 'mousemove|click',
      },
    }, { notMerge: false, lazyUpdate: true });
  }

  private buildZoomBarOnlyOption(): ChartOption {
    const darkTheme = isDarkChartThemeActive(this.chartTheme);
    const axisColor = darkTheme ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)';
    const sliderTrackColor = darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const sliderSelectionColor = darkTheme ? 'rgba(144,202,249,0.28)' : 'rgba(25,118,210,0.20)';
    const sliderHandleColor = darkTheme ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.45)';
    const domain = this.getActiveDomain();

    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
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
          show: true,
          left: 12,
          right: 12,
          top: 10,
          height: 20,
          filterMode: 'none',
          showDataShadow: false,
          showDetail: false,
          handleSize: 18,
          borderColor: axisColor,
          backgroundColor: sliderTrackColor,
          fillerColor: sliderSelectionColor,
          handleStyle: {
            color: sliderHandleColor,
            borderColor: axisColor,
            borderWidth: 1
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
          lineStyle: { opacity: 0 },
          data: [
            [domain.start, 0],
            [domain.end, 0]
          ]
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
      tooltipLines.push(
        `<div><span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${point.color};"></span>${point.seriesName}: ${formatted}</div>`
      );
    }

    return `<div style="font-weight:600;margin-bottom:4px;">${header}</div>${tooltipLines.join('')}`;
  }

  private formatDataValue(streamType: string, value: number, includeUnit = true): string {
    if (!Number.isFinite(value)) {
      return '--';
    }

    try {
      const dataInstance = DynamicDataLoader.getDataInstanceFromDataType(streamType, value);
      return includeUnit
        ? `${dataInstance.getDisplayValue()}${dataInstance.getDisplayUnit()}`
        : `${dataInstance.getDisplayValue()}`;
    } catch {
      return `${value.toFixed(2)}`;
    }
  }

  private syncNativeZoomGroup(): void {
    const chart = this.chartHost.getChart();
    if (!chart) {
      return;
    }

    const nextGroupId = `${this.zoomGroupId || ''}`.trim() || null;
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
