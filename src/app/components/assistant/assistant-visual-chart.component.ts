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
  effect,
  inject,
} from '@angular/core';
import {
  AppThemes,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import type {
  AssistantChartSeries,
  AssistantChartVisual,
} from '@shared/assistant.types';
import {
  formatDashboardAxisNumericValueWithoutUnit,
  formatDashboardNumericValue,
  resolveDashboardAxisDisplayUnit,
} from '../../helpers/dashboard-chart-data.helper';
import {
  buildDashboardEChartsStyleTokens,
  buildDashboardEChartsTooltipChrome,
  renderDashboardEChartsTooltipCard,
} from '../../helpers/dashboard-echarts-style.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import {
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../helpers/echarts-tooltip-interaction.helper';
import {
  ECHARTS_GLOBAL_FONT_FAMILY,
  resolveEChartsThemeName,
} from '../../helpers/echarts-theme.helper';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];

interface TooltipParam {
  color?: string;
  data?: [string | number, number | null];
  marker?: string;
  seriesName?: string;
  value?: [string | number, number | null];
}

interface AssistantAxisPresentation {
  key: string;
  dataType: string | null;
  rawUnit: string | null;
  rawMax: number;
  displayUnit: string;
}

const ASSISTANT_CHART_COLORS = ['#2196f3', '#10b981', '#f59e0b', '#8b5cf6'];

@Component({
  selector: 'app-assistant-visual-chart',
  standalone: true,
  templateUrl: './assistant-visual-chart.component.html',
  styleUrls: ['./assistant-visual-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantVisualChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) visual!: AssistantChartVisual;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly themeService = inject(AppThemeService);
  private readonly userSettingsQuery = inject(AppUserSettingsQueryService);
  private readonly chartHost = new EChartsHostController({
    eChartsLoader: inject(EChartsLoaderService),
    logger: inject(LoggerService),
    logPrefix: '[AssistantVisualChartComponent]',
  });
  private viewInitialized = false;

  constructor() {
    effect(() => {
      this.themeService.appTheme();
      this.userSettingsQuery.unitSettings();
      if (this.viewInitialized) {
        void this.refresh();
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewInitialized && changes.visual) {
      void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.chartHost.dispose();
  }

  private async refresh(): Promise<void> {
    const container = this.chartDiv?.nativeElement;
    if (!container || !this.visual) {
      return;
    }
    const darkTheme = this.themeService.appTheme() === AppThemes.Dark;
    const chart = await this.chartHost.init(container, resolveEChartsThemeName(darkTheme));
    if (!chart || !this.viewInitialized) {
      return;
    }
    this.chartHost.hideTooltip();
    this.chartHost.setOption(
      this.buildOption(darkTheme),
      ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
    );
    this.chartHost.scheduleResize();
  }

  private buildOption(darkTheme: boolean): ChartOption {
    const style = buildDashboardEChartsStyleTokens(
      darkTheme,
      this.chartDiv?.nativeElement.clientWidth || 0,
    );
    const unitSettings = this.userSettingsQuery.unitSettings();
    const yAxes = this.buildYAxisPresentations(unitSettings);
    const xAxis = this.buildXAxisPresentation(unitSettings);
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      ...(this.visual.xAxis.timeZone
        ? { timeZone: this.visual.xAxis.timeZone }
        : {}),
    });
    const isMobile = isEChartsMobileTooltipViewport();
    return {
      animation: false,
      backgroundColor: 'transparent',
      color: ASSISTANT_CHART_COLORS,
      textStyle: { color: style.textColor, fontFamily: ECHARTS_GLOBAL_FONT_FAMILY },
      grid: {
        left: yAxes.length > 2 ? 58 : 42,
        right: yAxes.length > 1 ? 52 + Math.max(0, yAxes.length - 2) * 34 : 18,
        top: 18,
        bottom: 34,
        containLabel: false,
      },
      tooltip: {
        trigger: 'axis',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobile),
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobile),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: (params: TooltipParam | TooltipParam[]) => {
          const entries = Array.isArray(params) ? params : [params];
          const firstValue = entries[0]?.value ?? entries[0]?.data;
          const x = Array.isArray(firstValue) ? firstValue[0] : null;
          const title = this.visual.xAxis.type === 'time' && x !== null
            ? dateFormatter.format(new Date(
                typeof x === 'number' ? x : Date.parse(`${x}`),
              ))
            : `${x ?? ''}`;
          return renderDashboardEChartsTooltipCard(style, {
            title,
            rows: entries.flatMap((entry) => {
              const value = entry.value ?? entry.data;
              const y = Array.isArray(value) ? value[1] : null;
              if (typeof y !== 'number' || !Number.isFinite(y)) {
                return [];
              }
              const series = this.visual.series.find(candidate => (
                candidate.label === entry.seriesName
              ));
              return [{
                label: entry.seriesName || 'Value',
                value: series
                  ? this.formatSeriesValue(series, y, unitSettings)
                  : this.formatRawValue(y, null),
                markerColor: entry.color || null,
              }];
            }),
          });
        },
      },
      xAxis: {
        type: this.visual.xAxis.type === 'category'
          ? 'category'
          : this.visual.xAxis.type === 'time' ? 'time' : 'value',
        name: xAxis.displayUnit
          ? `${this.visual.xAxis.label} (${xAxis.displayUnit})`
          : this.visual.xAxis.label,
        nameLocation: 'middle',
        nameGap: 25,
        boundaryGap: this.visual.chartType === 'bar',
        axisTick: { show: false },
        axisLine: { lineStyle: { color: style.axisColor } },
        splitLine: { show: false },
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          hideOverlap: true,
          ...(this.visual.xAxis.type === 'time'
            ? { formatter: (value: number) => dateFormatter.format(new Date(value)) }
            : xAxis.dataType
              ? { formatter: (value: number) => this.formatAxisValue(xAxis, value, unitSettings) }
              : {}),
        },
      },
      yAxis: yAxes.map((axis, index) => ({
        type: 'value',
        name: axis.displayUnit,
        position: index === 0 ? 'left' : 'right',
        offset: index <= 1 ? 0 : (index - 1) * 34,
        nameTextStyle: { color: style.secondaryTextColor },
        axisTick: { show: false },
        axisLine: { show: index > 0, lineStyle: { color: style.axisColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          formatter: (value: number) => this.formatAxisValue(axis, value, unitSettings),
        },
        splitLine: index === 0
          ? { lineStyle: { color: style.gridColor } }
          : { show: false },
      })),
      series: this.visual.series.map((series, index) => ({
        name: series.label,
        type: this.visual.chartType,
        yAxisIndex: yAxes.findIndex(axis => axis.key === this.seriesAxisKey(series)),
        connectNulls: false,
        showSymbol: series.points.length <= 30,
        symbol: 'circle',
        symbolSize: 6,
        barMaxWidth: 24,
        data: series.points.map(point => [
          this.visual.xAxis.type === 'time' ? Date.parse(`${point.x}`) : point.x,
          point.y,
        ]),
        lineStyle: { width: 2.25, color: ASSISTANT_CHART_COLORS[index] },
        itemStyle: { color: ASSISTANT_CHART_COLORS[index] },
        emphasis: { focus: 'series' },
      })),
    };
  }

  private buildYAxisPresentations(
    unitSettings: UserUnitSettingsInterface,
  ): AssistantAxisPresentation[] {
    const axes = new Map<string, Omit<AssistantAxisPresentation, 'displayUnit'>>();
    this.visual.series.forEach((series) => {
      const key = this.seriesAxisKey(series);
      const rawMax = this.maximumAbsoluteValue(series.points.map(point => point.y));
      const existing = axes.get(key);
      if (existing) {
        existing.rawMax = Math.max(existing.rawMax, rawMax);
        return;
      }
      axes.set(key, {
        key,
        dataType: series.dataType || null,
        rawUnit: series.unit,
        rawMax,
      });
    });

    return [...axes.values()].map(axis => ({
      ...axis,
      displayUnit: resolveDashboardAxisDisplayUnit(
        axis.dataType || undefined,
        axis.rawMax,
        unitSettings,
        axis.rawUnit || 'Value',
      ),
    }));
  }

  private buildXAxisPresentation(
    unitSettings: UserUnitSettingsInterface,
  ): AssistantAxisPresentation {
    const axis = {
      key: 'x-axis',
      dataType: this.visual.xAxis.dataType || null,
      rawUnit: this.visual.xAxis.unit,
      rawMax: this.maximumAbsoluteValue(
        this.visual.series.flatMap(series => series.points.map(point => point.x)),
      ),
    };
    return {
      ...axis,
      displayUnit: resolveDashboardAxisDisplayUnit(
        axis.dataType || undefined,
        axis.rawMax,
        unitSettings,
        axis.rawUnit || '',
      ),
    };
  }

  private formatAxisValue(
    axis: AssistantAxisPresentation,
    value: number,
    unitSettings: UserUnitSettingsInterface,
  ): string {
    if (!axis.dataType) {
      return this.formatRawValue(value, null);
    }
    return formatDashboardAxisNumericValueWithoutUnit(
      axis.dataType,
      value,
      undefined,
      unitSettings,
      axis.rawMax,
    );
  }

  private formatSeriesValue(
    series: AssistantChartSeries,
    value: number,
    unitSettings: UserUnitSettingsInterface,
  ): string {
    if (!series.dataType) {
      return this.formatRawValue(value, series.unit);
    }
    return formatDashboardNumericValue(
      series.dataType,
      value,
      undefined,
      unitSettings,
    );
  }

  private seriesAxisKey(series: AssistantChartSeries): string {
    return series.dataType
      ? `type:${series.dataType}|unit:${series.unit || ''}`
      : `unit:${series.unit || 'Value'}`;
  }

  private maximumAbsoluteValue(values: Array<string | number | null>): number {
    return values.reduce<number>((maximum, value) => (
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(maximum, Math.abs(value))
        : maximum
    ), 0);
  }

  private formatRawValue(value: number, unit: string | null): string {
    const formatted = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value);
    return `${formatted}${unit ? ` ${unit}` : ''}`;
  }
}
