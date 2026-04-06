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
  resolveEChartsTooltipTriggerOn,
} from '../../../helpers/echarts-tooltip-interaction.helper';
import { ECHARTS_GLOBAL_FONT_FAMILY, resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { formatDashboardDateByInterval } from '../../../helpers/dashboard-chart-data.helper';
import {
  buildDashboardFormRenderPoints,
  DashboardFormPoint,
  resolveDashboardFormLatestPoint,
  resolveDashboardFormStatus,
  resolveDashboardFormValue,
} from '../../../helpers/dashboard-form.helper';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type EChartsTooltipPositionSize = {
  contentSize?: [number, number];
  viewSize?: [number, number];
};

@Component({
  selector: 'app-form-chart',
  templateUrl: './charts.form.component.html',
  styleUrls: ['./charts.form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ChartsFormComponent implements AfterViewInit, OnChanges, OnDestroy {
  private static readonly FORM_MODE = 'prior-day' as const;
  private static readonly FORM_RENDER_INTERVAL = TimeIntervals.Weekly;

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

  readonly hasData = computed(() => this.pointsSignal().length > 0);
  readonly latestPoint = computed(() => resolveDashboardFormLatestPoint(this.pointsSignal()));
  readonly selectedFormValue = computed(() => resolveDashboardFormValue(this.latestPoint(), ChartsFormComponent.FORM_MODE));
  readonly status = computed(() => resolveDashboardFormStatus(this.selectedFormValue()));
  readonly headlineStats = computed(() => {
    const latest = this.latestPoint();
    return {
      fitness: {
        value: this.formatRoundedValue(latest?.ctl),
      },
      fatigue: {
        value: this.formatRoundedValue(latest?.atl),
      },
      form: {
        value: this.formatRoundedValue(this.selectedFormValue()),
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
    const renderTimeInterval = ChartsFormComponent.FORM_RENDER_INTERVAL;
    const points = buildDashboardFormRenderPoints(sourcePoints, renderTimeInterval);
    const axisLabels = points.map(point => this.formatAxisDateLabel(point.time, renderTimeInterval));
    const xAxisLabelInterval = this.resolveXAxisLabelInterval(points.length);
    const ctlValues = points.map(point => point.ctl);
    const atlValues = points.map(point => point.atl);
    const formValues = points.map(point => resolveDashboardFormValue(point, ChartsFormComponent.FORM_MODE));
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();

    const topAxisConfig = buildDashboardValueAxisConfig([...ctlValues, ...atlValues]);
    const bottomAxisConfig = buildDashboardValueAxisConfig(
      [...formValues, 0].filter((value): value is number => Number.isFinite(value)),
    );

    const topXAxis = {
      type: 'category',
      data: axisLabels,
      axisLabel: { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: chartStyle.axisColor } },
      splitLine: { show: false },
      boundaryGap: false,
    };

    const bottomXAxis = {
      type: 'category',
      data: axisLabels,
      axisLabel: {
        show: true,
        color: chartStyle.textColor,
        fontSize: chartStyle.axisFontSize,
        hideOverlap: false,
        interval: xAxisLabelInterval,
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
        show: true,
        confine: true,
        position: (_point: number[], _params: unknown, _dom: unknown, _rect: unknown, size: EChartsTooltipPositionSize) => (
          this.resolveTooltipPosition(size)
        ),
        backgroundColor: chartStyle.tooltipBackgroundColor,
        borderColor: chartStyle.tooltipBorderColor,
        borderWidth: 1,
        padding: 0,
        textStyle: {
          color: chartStyle.tooltipTextColor,
          fontFamily: ECHARTS_GLOBAL_FONT_FAMILY,
          fontSize: chartStyle.isCompactLayout ? 12 : 13,
        },
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
          data: ctlValues,
          smooth: false,
          connectNulls: true,
          symbol: 'none',
          lineStyle: {
            width: 1.5,
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
          symbol: 'none',
          lineStyle: {
            width: 1.5,
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
          symbol: 'none',
          lineStyle: {
            width: 1.3,
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
    const statusColor = AppColors.Pink;
    const valueColor = chartStyle.tooltipTextColor;
    const labelColor = chartStyle.secondaryTextColor;
    const dividerColor = chartStyle.tooltipBorderColor;

    const renderMetric = (label: string, value: string): string => (
      `<div style="display:flex;flex-direction:column;gap:2px;min-width:0;">`
      + `<div style="font-family:${ECHARTS_GLOBAL_FONT_FAMILY};font-size:${chartStyle.isCompactLayout ? 15 : 16}px;line-height:1.15;font-weight:700;color:${valueColor};">${this.escapeHtml(value)}</div>`
      + `<div style="font-size:${chartStyle.isCompactLayout ? 11 : 12}px;line-height:1.2;color:${labelColor};white-space:nowrap;">${this.escapeHtml(label)}</div>`
      + `</div>`
    );

    return (
      `<div class="qs-form-tooltip-card" style="min-width:312px;max-width:340px;`
      + `padding:12px 14px 10px;font-family:${ECHARTS_GLOBAL_FONT_FAMILY};">`
      + `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">`
      + `<div style="font-size:13px;line-height:1.2;font-weight:700;color:${statusColor};">${this.escapeHtml(statusTitle)}</div>`
      + `<div style="font-size:12px;line-height:1.2;color:${labelColor};white-space:nowrap;">${this.escapeHtml(dateLabel)}</div>`
      + `</div>`
      + `<div style="height:1px;background:${dividerColor};margin:9px 0 10px;"></div>`
      + `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px;">`
      + renderMetric('Fitness', this.formatRoundedValue(point.ctl))
      + renderMetric('Fatigue', this.formatRoundedValue(point.atl))
      + renderMetric('Form', this.formatRoundedValue(formValue))
      + renderMetric('TSS', this.formatRoundedValue(point.trainingStressScore))
      + renderMetric('Fitness change', this.formatSignedRoundedValue(fitnessChange))
      + `<div aria-hidden="true"></div>`
      + `</div>`
      + `</div>`
    );
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

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll('\'', '&#39;');
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

  private formatAxisDateLabel(time: number, interval: TimeIntervals): string {
    const date = new Date(time);
    if (!Number.isFinite(date.getTime())) {
      return '';
    }

    if (interval === TimeIntervals.Daily) {
      return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    }

    if (interval === TimeIntervals.Monthly) {
      return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }

    if (interval === TimeIntervals.Yearly) {
      return date.toLocaleDateString(undefined, { year: 'numeric' });
    }

    if (interval === TimeIntervals.Weekly) {
      return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    }

    return formatDashboardDateByInterval(time, interval);
  }

  private resolveXAxisLabelInterval(pointCount: number): number {
    if (!Number.isFinite(pointCount) || pointCount <= 8) {
      return 0;
    }

    const targetVisibleLabels = 6;
    return Math.max(0, Math.ceil(pointCount / targetVisibleLabels) - 1);
  }
}
