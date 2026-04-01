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
import { buildDashboardEChartsStyleTokens } from '../../../helpers/dashboard-echarts-style.helper';
import { buildDashboardValueAxisConfig } from '../../../helpers/dashboard-echarts-yaxis.helper';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { formatDashboardDateByInterval } from '../../../helpers/dashboard-chart-data.helper';
import {
  buildDashboardFormRenderPoints,
  DashboardFormMode,
  DashboardFormPoint,
  resolveDashboardFormLatestPoint,
  resolveDashboardFormRenderTimeInterval,
  resolveDashboardFormStatus,
  resolveDashboardFormValue,
} from '../../../helpers/dashboard-form.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];

@Component({
  selector: 'app-form-chart',
  templateUrl: './charts.form.component.html',
  styleUrls: ['./charts.form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsFormComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() darkTheme = false;
  @Input() isLoading = false;
  @Input() set data(value: DashboardFormPoint[] | null | undefined) {
    this.pointsSignal.set(Array.isArray(value) ? value : []);
    if (this.chartDiv?.nativeElement) {
      void this.refreshChart();
    }
  }

  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private readonly pointsSignal = signal<DashboardFormPoint[]>([]);
  private readonly modeSignal = signal<DashboardFormMode>('same-day');

  readonly hasData = computed(() => this.pointsSignal().length > 0);
  readonly formMode = computed(() => this.modeSignal());
  readonly latestPoint = computed(() => resolveDashboardFormLatestPoint(this.pointsSignal()));
  readonly selectedFormValue = computed(() => resolveDashboardFormValue(this.latestPoint(), this.modeSignal()));
  readonly status = computed(() => resolveDashboardFormStatus(this.selectedFormValue()));
  readonly headlineStats = computed(() => {
    const latest = this.latestPoint();
    return {
      fitness: this.formatRoundedValue(latest?.ctl),
      fatigue: this.formatRoundedValue(latest?.atl),
      form: this.formatRoundedValue(this.selectedFormValue()),
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
    });
  }

  async ngAfterViewInit(): Promise<void> {
    await this.refreshChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chartDiv?.nativeElement) {
      return;
    }

    if (changes.darkTheme || changes.isLoading) {
      void this.refreshChart();
    }
  }

  ngOnDestroy(): void {
    this.chartHost.dispose();
  }

  onFormModeChange(mode: DashboardFormMode): void {
    if (mode !== 'same-day' && mode !== 'prior-day') {
      return;
    }
    if (mode === this.modeSignal()) {
      return;
    }
    this.modeSignal.set(mode);
    void this.refreshChart();
  }

  private async refreshChart(): Promise<void> {
    const chart = await this.chartHost.init(
      this.chartDiv?.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart) {
      return;
    }

    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildChartOption(), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildChartOption(): ChartOption {
    const sourcePoints = this.pointsSignal();
    if (!sourcePoints.length) {
      return {
        animation: false,
        tooltip: { show: false },
        xAxis: [],
        yAxis: [],
        series: [],
      };
    }

    const chartWidth = this.chartDiv?.nativeElement?.clientWidth || 0;
    const chartStyle = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const renderTimeInterval = resolveDashboardFormRenderTimeInterval(sourcePoints);
    const points = buildDashboardFormRenderPoints(sourcePoints, renderTimeInterval);
    const labels = points.map(point => formatDashboardDateByInterval(point.time, renderTimeInterval));
    const ctlValues = points.map(point => point.ctl);
    const atlValues = points.map(point => point.atl);
    const formValues = points.map(point => resolveDashboardFormValue(point, this.modeSignal()));
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();

    const topAxisConfig = buildDashboardValueAxisConfig([...ctlValues, ...atlValues]);
    const bottomAxisConfig = buildDashboardValueAxisConfig(
      [...formValues, 0].filter((value): value is number => Number.isFinite(value)),
    );

    const topXAxis = {
      type: 'category',
      data: labels,
      axisLabel: { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartStyle.axisColor } },
      splitLine: { show: false },
      boundaryGap: false,
    };

    const bottomXAxis = {
      type: 'category',
      data: labels,
      axisLabel: {
        show: true,
        color: chartStyle.textColor,
        fontSize: chartStyle.axisFontSize,
        hideOverlap: true,
        interval: 0,
        rotate: renderTimeInterval === TimeIntervals.Daily ? (chartStyle.isCompactLayout ? 52 : 40) : 0,
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
    };

    const gridLeft = chartStyle.isCompactLayout ? 34 : 38;
    const gridRight = chartStyle.isCompactLayout ? 14 : 16;
    const panelHeight = chartStyle.isCompactLayout ? '38%' : '40%';
    const topPanelTop = chartStyle.isCompactLayout ? '5%' : '4%';
    const bottomPanelTop = chartStyle.isCompactLayout ? '54%' : '52%';

    return {
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
      },
      tooltip: {
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        axisPointer: { type: 'line' },
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        borderWidth: 1,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: chartStyle.isCompactLayout ? 12 : 13,
        },
        formatter: (params: { dataIndex: number }[]) => this.formatTooltip(points, params, renderTimeInterval),
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
          data: ctlValues,
          smooth: false,
          connectNulls: true,
          symbol: 'circle',
          symbolSize: chartStyle.isCompactLayout ? 5 : 6,
          lineStyle: {
            width: 2.1,
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
          data: atlValues,
          smooth: false,
          connectNulls: true,
          symbol: 'circle',
          symbolSize: chartStyle.isCompactLayout ? 5 : 6,
          lineStyle: {
            width: 2.1,
            color: AppColors.Pink,
          },
          itemStyle: {
            color: AppColors.Pink,
          },
        },
        {
          name: 'Form (TSB)',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: formValues,
          smooth: false,
          connectNulls: false,
          symbol: 'circle',
          symbolSize: chartStyle.isCompactLayout ? 4 : 5,
          lineStyle: {
            width: 2,
            color: chartStyle.secondaryTextColor,
          },
          itemStyle: {
            color: chartStyle.secondaryTextColor,
          },
        },
      ],
    };
  }

  private formatTooltip(
    points: DashboardFormPoint[],
    params: { dataIndex: number }[] | undefined,
    renderTimeInterval: TimeIntervals,
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

    const formValue = resolveDashboardFormValue(point, this.modeSignal());
    const formLabel = this.modeSignal() === 'prior-day' ? 'Form (TSB prior-day)' : 'Form (TSB)';

    return [
      formatDashboardDateByInterval(point.time, renderTimeInterval),
      `TSS: <b>${this.formatDetailedValue(point.trainingStressScore)}</b>`,
      `Fitness (CTL): <b>${this.formatDetailedValue(point.ctl)}</b>`,
      `Fatigue (ATL): <b>${this.formatDetailedValue(point.atl)}</b>`,
      `${formLabel}: <b>${this.formatDetailedValue(formValue)}</b>`,
    ].join('<br/>');
  }

  private formatRoundedValue(value: number | null | undefined): string {
    return Number.isFinite(value as number) ? `${Math.round(value as number)}` : '--';
  }

  private formatDetailedValue(value: number | null | undefined): string {
    if (!Number.isFinite(value as number)) {
      return '--';
    }
    return Number(value).toFixed(1);
  }
}
