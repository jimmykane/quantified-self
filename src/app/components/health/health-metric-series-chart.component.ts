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
  HealthChartSeriesModel,
  buildHealthMetricEChartsOption,
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
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef<HTMLDivElement>;

  private readonly chartHost: EChartsHostController;
  private viewInitialized = false;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
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
    this.chartHost.setOption(
      buildHealthMetricEChartsOption(
        this.model,
        this.startTimeMs,
        this.endTimeMs,
        style,
        isEChartsMobileTooltipViewport(),
        this.unitSettings,
      ),
      ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
    );
    this.chartHost.scheduleResize();
  }
}
