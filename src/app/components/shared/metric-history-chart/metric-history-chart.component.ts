import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, viewChild } from '@angular/core';
import { buildMetricHistoryChartOption, normalizeMetricHistoryPoints, type MetricHistory } from '../../../helpers/metric-history-chart.helper';
import { buildDashboardEChartsStyleTokens, buildDashboardEChartsTooltipChrome, renderDashboardEChartsTooltipCard } from '../../../helpers/dashboard-echarts-style.helper';
import { ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS, EChartsHostController } from '../../../helpers/echarts-host-controller';
import { isEChartsMobileTooltipViewport, resolveEChartsTooltipSurfaceConfig, resolveEChartsTooltipTriggerOn } from '../../../helpers/echarts-tooltip-interaction.helper';
import { resolveEChartsThemeName } from '../../../helpers/echarts-theme.helper';
import { formatDashboardWeekRangeLabel } from '../../../helpers/dashboard-chart-data.helper';
import { getDateTimeFormatter } from '../../../helpers/date-time-format.helper';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import type { EChartsOption } from 'echarts';

@Component({
  selector: 'app-metric-history-chart', standalone: true,
  template: `<div #chartDiv class="metric-history-plot" role="img" [attr.aria-label]="accessibleSummary()"></div><small>{{ history().caption }}</small>`,
  styles: `:host { display: block; min-width: 0; margin-top: 8px; }
    .metric-history-plot { width: 100%; height: 38px; }
    small { display: block; margin-top: 3px; color: var(--mat-sys-on-surface-variant); font-size: 10px; line-height: 1.3; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricHistoryChartComponent {
  readonly history = input.required<MetricHistory>();
  readonly label = input.required<string>();
  readonly darkTheme = input(false);
  private readonly container = viewChild<ElementRef<HTMLElement>>('chartDiv');
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = new EChartsHostController({
    deferUntilNearViewport: true,
    eChartsLoader: inject(EChartsLoaderService), logger: inject(LoggerService), logPrefix: '[MetricHistoryChart]',
  });
  private renderVersion = 0;

  readonly accessibleSummary = computed(() => {
    const history = this.history();
    const points = normalizeMetricHistoryPoints(history.points);
    return `${this.label()} · ${history.caption}. ${points.map(point => `${this.dateLabel(point.time, history)}: ${history.points.find(source => source.time === point.time)?.valueText || 'Unavailable'}`).join('; ')}`;
  });

  constructor() {
    effect(() => {
      const container = this.container()?.nativeElement;
      const history = this.history();
      const dark = this.darkTheme();
      const label = this.label();
      if (container) void this.render(container, history, dark, label);
    });
    this.destroyRef.onDestroy(() => { this.renderVersion++; this.host.dispose(); });
  }

  private async render(container: HTMLElement, history: MetricHistory, dark: boolean, label: string): Promise<void> {
    const version = ++this.renderVersion;
    const chart = await this.host.init(container, resolveEChartsThemeName(dark));
    if (!chart || this.destroyRef.destroyed || version !== this.renderVersion) return;
    const style = buildDashboardEChartsStyleTokens(dark, container.clientWidth);
    const mobile = isEChartsMobileTooltipViewport();
    const option = buildMetricHistoryChartOption(history.points, {
      color: style.trendLineColor, mutedColor: style.gridColor, baselineColor: style.axisColor, mode: history.mode,
    });
    option.tooltip = {
      trigger: 'axis', triggerOn: resolveEChartsTooltipTriggerOn(true, mobile), renderMode: 'html',
      ...resolveEChartsTooltipSurfaceConfig(mobile), ...buildDashboardEChartsTooltipChrome(style),
      formatter: (params: { data?: unknown } | { data?: unknown }[]) => {
        const data = (Array.isArray(params) ? params[0] : params)?.data;
        const point = history.points.find(point => Array.isArray(data) && point.time === data[0]);
        return point ? renderDashboardEChartsTooltipCard(style, {
          title: this.dateLabel(point.time, history), rows: [{ label, value: point.valueText }],
          notes: history.mode === 'forecast' ? ['No additional training load; a scenario, not a prediction.'] : undefined,
        }) : '';
      },
    } as EChartsOption['tooltip'];
    this.host.hideTooltip();
    this.host.setOption(option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.host.scheduleResize();
  }

  private dateLabel(time: number, history: MetricHistory): string {
    return history.mode === 'forecast'
      ? getDateTimeFormatter(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(time)
      : formatDashboardWeekRangeLabel(time, undefined, 'UTC');
  }
}
