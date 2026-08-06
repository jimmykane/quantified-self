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
import { AppThemes } from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import type { AssistantChartVisual } from '@shared/assistant.types';
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

const ASSISTANT_CHART_COLORS = ['#2196f3', '#10b981', '#f59e0b', '#8b5cf6'];

@Component({
  selector: 'app-assistant-visual-chart',
  standalone: true,
  template: `
    <div
      #chartDiv
      class="assistant-visual-chart"
      role="img"
      [attr.aria-label]="visual.title"
    ></div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .assistant-visual-chart { width: 100%; height: 220px; }
    :host-context(.assistant-visual-detail) .assistant-visual-chart { height: min(62vh, 520px); }
    @media (max-width: 720px) {
      .assistant-visual-chart { height: 210px; }
      :host-context(.assistant-visual-detail) .assistant-visual-chart { height: min(58vh, 440px); }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantVisualChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) visual!: AssistantChartVisual;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly themeService = inject(AppThemeService);
  private readonly chartHost = new EChartsHostController({
    eChartsLoader: inject(EChartsLoaderService),
    logger: inject(LoggerService),
    logPrefix: '[AssistantVisualChartComponent]',
  });
  private viewInitialized = false;

  constructor() {
    effect(() => {
      this.themeService.appTheme();
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
    const units = [...new Set(this.visual.series.map(series => series.unit || 'Value'))];
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
        left: units.length > 2 ? 58 : 42,
        right: units.length > 1 ? 52 + Math.max(0, units.length - 2) * 34 : 18,
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
                value: `${new Intl.NumberFormat(undefined, {
                  maximumFractionDigits: 2,
                }).format(y)}${series?.unit ? ` ${series.unit}` : ''}`,
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
        name: this.visual.xAxis.unit
          ? `${this.visual.xAxis.label} (${this.visual.xAxis.unit})`
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
            : {}),
        },
      },
      yAxis: units.map((unit, index) => ({
        type: 'value',
        name: unit,
        position: index === 0 ? 'left' : 'right',
        offset: index <= 1 ? 0 : (index - 1) * 34,
        nameTextStyle: { color: style.secondaryTextColor },
        axisTick: { show: false },
        axisLine: { show: index > 0, lineStyle: { color: style.axisColor } },
        axisLabel: {
          color: style.secondaryTextColor,
          fontSize: style.axisFontSize,
          formatter: (value: number) => new Intl.NumberFormat(undefined, {
            maximumFractionDigits: 1,
          }).format(value),
        },
        splitLine: index === 0
          ? { lineStyle: { color: style.gridColor } }
          : { show: false },
      })),
      series: this.visual.series.map((series, index) => ({
        name: series.label,
        type: this.visual.chartType,
        yAxisIndex: units.indexOf(series.unit || 'Value'),
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
}
