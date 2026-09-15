import type { TimelineNoteChartContext } from '../../helpers/timeline-notes-chart.helper';
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
} from '@angular/core';
import {
  buildDashboardEChartsStyleTokens,
} from '../../helpers/dashboard-echarts-style.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import {
  DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
  isEChartsMobileTooltipViewport,
} from '../../helpers/echarts-tooltip-interaction.helper';
import { resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import {
  HealthChartStatusOverlay,
  HealthChartSeriesModel,
  buildHealthMetricEChartsOption,
  nearestTimezoneOffsetSeconds,
} from '../../helpers/health-metric-chart.helper';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-health-metric-series-chart',
  standalone: true,
  templateUrl: './health-metric-series-chart.component.html',
  styleUrls: ['./health-metric-series-chart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthMetricSeriesChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) model!: HealthChartSeriesModel;
  @Input({ required: true }) startTimeMs!: number;
  @Input({ required: true }) endTimeMs!: number;
  @Input() darkTheme = false;
  @Input() timelineNotes: TimelineNoteChartContext | null = null;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
  @Input() compact = false;
  @Input() thumbnail = false;
  @Input() fillHeight = false;
  @Input() statusOverlay: HealthChartStatusOverlay | null = null;
  @Input() statusDescription: string | null = null;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private viewInitialized = false;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
      deferUntilNearViewport: true,
      eChartsLoader,
      logger,
      logPrefix: '[HealthMetricSeriesChartComponent]',
      mobileTapFeedbackOptions: DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewInitialized && (
      changes.model || changes.startTimeMs || changes.endTimeMs || changes.darkTheme || changes.unitSettings
      || changes.compact || changes.thumbnail || changes.statusOverlay || changes.timelineNotes
    )) {
      void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.chartHost.dispose();
  }

  private async refresh(): Promise<void> {
    if (!this.chartDiv?.nativeElement || !this.model) {
      return;
    }
    const chart = await this.chartHost.init(
      this.chartDiv.nativeElement,
      resolveEChartsThemeName(this.darkTheme),
    );
    if (!chart || !this.viewInitialized) {
      return;
    }
    const style = buildDashboardEChartsStyleTokens(
      this.darkTheme,
      this.chartDiv.nativeElement.clientWidth || 0,
    );
    this.chartHost.hideTooltip();
    this.chartHost.setTimelineNotes(this.timelineNotes, {
      offsetSeconds: timestamp => nearestTimezoneOffsetSeconds(this.model.displayedPoints, timestamp) ?? 0,
    });
    const option = buildHealthMetricEChartsOption(
        this.model,
        this.startTimeMs,
        this.endTimeMs,
        style,
        isEChartsMobileTooltipViewport(),
        this.unitSettings,
        this.compact || this.thumbnail,
        this.statusOverlay,
      );
    if (this.thumbnail) {
      Object.assign(option, { grid:{left:2,right:2,top:3,bottom:3}, tooltip:{show:false}, legend:{show:false}, dataZoom:[] });
      // A sparkline has no date axis: fit the recorded span so sparse history is
      // still legible, preserving every value and the gaps between readings.
      const points = this.model.displayedPoints;
      if (points.length) {
        const first = points[0].timestampMs, last = points.at(-1)!.timestampMs;
        const padding = Math.max((last - first) * 0.05, 1);
        for (const axis of [option.xAxis].flat()) if (axis) Object.assign(axis, { min:first - padding, max:last + padding });
      }
      // Zero is a real reading too: a minimal bar keeps an all-zero thumbnail visible.
      for (const series of [option.series].flat()) if (series && typeof series === 'object' && 'type' in series) {
        if (series.type === 'bar') Object.assign(series, {barMinHeight:2});
        if (series.type === 'line' && 'lineStyle' in series) Object.assign(series.lineStyle, {width:1.5});
        if (points.length === 1 && (series.type === 'scatter' || series.type === 'line')) Object.assign(series, {symbolSize:6});
      }
      for (const axis of [option.xAxis, option.yAxis].flat()) if (axis) Object.assign(axis, {show:false});
    }
    this.chartHost.setOption(option, ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }
}
