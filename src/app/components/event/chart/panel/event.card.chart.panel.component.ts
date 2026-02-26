import {
  AfterViewInit,
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
import { EChartsHostController } from '../../../../helpers/echarts-host-controller';
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
import {
  computeEventPanelRangeStats,
  EventPanelRangeStat
} from '../../../../helpers/event-echarts-range-stats.helper';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';

type ChartOption = Parameters<EChartsType['setOption']>[0];

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
  @Input() interactionMode: 'zoom' | 'select' = 'zoom';
  @Input() showZoomBar = false;
  @Input() zoomGroupId: string | null = null;
  @Input() zoomResetVersion = 0;
  @Input() xDomain: EventChartRange | null = null;
  @Input() selectionRange: EventChartRange | null = null;
  @Input() showLaps = true;
  @Input() lapTypes: LapTypes[] = [];
  @Input() lapMarkers: EventChartLapMarker[] = [];
  @Input() gainAndLossThreshold = 1;
  @Input() extraMaxForPower = 0;
  @Input() extraMaxForPace = -0.25;

  @Output() selectionRangeChange = new EventEmitter<EventChartRange | null>();
  @Output() cursorPositionChange = new EventEmitter<number>();

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  public rangeStats: EventPanelRangeStat[] = [];

  private readonly chartHost: EChartsHostController;
  private eventsBound = false;
  private connectedZoomGroupId: string | null = null;
  private lastAppliedZoomResetVersion = -1;
  private wheelPassThroughListener: ((event: Event) => void) | null = null;

  constructor(
    private eChartsLoader: EChartsLoaderService,
    private logger: LoggerService
  ) {
    this.chartHost = new EChartsHostController({
      eChartsLoader: this.eChartsLoader,
      logger: this.logger,
      logPrefix: '[EventCardChartPanelComponent]'
    });
  }

  get hasSelection(): boolean {
    return !!this.selectionRange;
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

    if (changes.xDomain || changes.zoomGroupId) {
      this.lastAppliedZoomResetVersion = -1;
    }

    if (
      changes.panel
      || changes.xAxisType
      || changes.chartTheme
      || changes.useAnimations
      || changes.interactionMode
      || changes.showZoomBar
      || changes.zoomGroupId
      || changes.zoomResetVersion
      || changes.xDomain
      || changes.selectionRange
      || changes.showLaps
      || changes.lapMarkers
      || changes.extraMaxForPower
      || changes.extraMaxForPace
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

    this.syncNativeZoomGroup();

    if (!this.panel || !this.panel.series.length) {
      this.rangeStats = [];
      this.chartHost.setOption({
        animation: this.useAnimations === true,
        xAxis: [],
        yAxis: [],
        series: []
      }, { notMerge: true, lazyUpdate: true });
      return;
    }

    this.chartHost.setOption(this.buildOption(), { notMerge: true, lazyUpdate: true });
    this.applyExternalInteractions();
    this.updateRangeStats();
    this.chartHost.scheduleResize();
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

    const seriesOptions: any[] = panel.series.map((series) => ({
      id: series.id,
      name: series.activityName,
      type: 'line',
      smooth: false,
      showSymbol: false,
      symbolSize: 5,
      animation: this.useAnimations === true,
      lineStyle: {
        width: 2,
        color: series.color,
      },
      itemStyle: {
        color: series.color,
      },
      emphasis: {
        focus: 'series',
      },
      data: series.points.map((point) => [point.x, point.y])
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
      textStyle: {
        color: textColor,
        fontFamily: "'Barlow Condensed', sans-serif"
      },
      grid: {
        left: 12,
        right: 16,
        top: 8,
        bottom: this.interactionMode === 'zoom' && this.showZoomBar ? 40 : 16,
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
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
          formatter: (value: number) => formatEventXAxisValue(Number(value), this.xAxisType)
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
          formatter: (value: number) => this.formatDataValue(panel.dataType, value)
        }
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: false,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          preventDefaultMouseMove: false,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          show: this.showZoomBar && this.interactionMode === 'zoom',
          height: 16,
          bottom: 8,
          filterMode: 'none',
          showDataShadow: false,
        }
      ],
      brush: this.interactionMode === 'select'
        ? {
          xAxisIndex: 0,
          brushType: 'lineX',
          brushMode: 'single',
          transformable: false,
          throttleType: 'debounce',
          throttleDelay: 80,
        }
        : undefined,
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
    if (!chart || this.eventsBound) {
      return;
    }

    chart.on('brushSelected', (params: any) => {
      if (this.interactionMode !== 'select' || !this.panel) {
        return;
      }

      const coordRange = params?.batch?.[0]?.areas?.[0]?.coordRange;
      if (!Array.isArray(coordRange) || coordRange.length !== 2) {
        this.selectionRangeChange.emit(null);
        return;
      }

      const domain = this.getActiveDomain();
      const range = clampEventRange({ start: Number(coordRange[0]), end: Number(coordRange[1]) }, domain.start, domain.end);

      if (!this.areRangesEqual(range, this.selectionRange)) {
        this.selectionRangeChange.emit(range);
      }
    });

    chart.on('updateAxisPointer', (params: any) => {
      const value = Number(params?.axesInfo?.[0]?.value);
      if (Number.isFinite(value)) {
        this.cursorPositionChange.emit(value);
      }
    });

    this.eventsBound = true;
  }

  private applyExternalInteractions(): void {
    const chart = this.chartHost.getChart();
    if (!chart || !this.panel) {
      return;
    }

    this.applyZoomResetIfRequested(chart);

    if (this.interactionMode === 'select' && this.selectionRange) {
      const domain = this.getActiveDomain();
      const selectionRange = clampEventRange(this.selectionRange, domain.start, domain.end);
      if (selectionRange) {
        chart.dispatchAction({
          type: 'brush',
          silent: true,
          areas: [{
            brushType: 'lineX',
            xAxisIndex: 0,
            coordRange: [selectionRange.start, selectionRange.end],
          }],
        });
      }
    } else {
      chart.dispatchAction({
        type: 'brush',
        silent: true,
        areas: [],
      });
    }
  }

  private applyZoomResetIfRequested(chart: EChartsType): void {
    if (this.zoomResetVersion === this.lastAppliedZoomResetVersion) {
      return;
    }
    if (this.zoomGroupId && !this.showZoomBar) {
      this.lastAppliedZoomResetVersion = this.zoomResetVersion;
      return;
    }

    const domain = this.getActiveDomain();
    chart.dispatchAction({
      type: 'dataZoom',
      silent: true,
      startValue: domain.start,
      endValue: domain.end,
    });
    this.lastAppliedZoomResetVersion = this.zoomResetVersion;
  }

  private updateRangeStats(): void {
    if (!this.panel) {
      this.rangeStats = [];
      return;
    }

    this.rangeStats = computeEventPanelRangeStats({
      panel: this.panel,
      range: this.selectionRange,
      xAxisType: this.xAxisType,
      gainAndLossThreshold: this.gainAndLossThreshold,
    });
  }

  private formatTooltip(params: any): string {
    if (!this.panel || !Array.isArray(params) || params.length === 0) {
      return '';
    }

    const xValue = Number(params[0]?.value?.[0]);
    const header = formatEventXAxisValue(xValue, this.xAxisType);

    const seriesLines = params.map((point: any) => {
      const seriesModel = this.panel?.series.find((series) => series.id === point.seriesId);
      const streamType = seriesModel?.streamType || this.panel?.dataType;
      const yValue = Number(Array.isArray(point.value) ? point.value[1] : point.value);
      const formatted = this.formatDataValue(streamType || '', yValue);

      return `<div><span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${point.color};"></span>${point.seriesName}: ${formatted}</div>`;
    });

    return `<div style="font-weight:600;margin-bottom:4px;">${header}</div>${seriesLines.join('')}`;
  }

  private formatDataValue(streamType: string, value: number): string {
    if (!Number.isFinite(value)) {
      return '--';
    }

    try {
      const dataInstance = DynamicDataLoader.getDataInstanceFromDataType(streamType, value);
      return `${dataInstance.getDisplayValue()}${dataInstance.getDisplayUnit()}`;
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

  private areRangesEqual(left: EventChartRange | null, right: EventChartRange | null): boolean {
    if (!left || !right) {
      return false;
    }
    return Math.abs(left.start - right.start) < 0.0001 && Math.abs(left.end - right.end) < 0.0001;
  }
}
