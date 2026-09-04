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
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { SLEEP_SPORTS_LIB_METRIC_FIELDS } from '@shared/sleep';
import { formatCanonicalSleepMetricSportsLibValue } from '@shared/sports-lib-health-data';
import type { EChartsType } from 'echarts/core';
import {
  buildDashboardEChartsTooltipChrome,
  buildDashboardEChartsStyleTokens,
  renderDashboardEChartsTooltipCard,
} from '../../helpers/dashboard-echarts-style.helper';
import type { DashboardSleepTrendPoint } from '../../helpers/dashboard-sleep-chart.helper';
import {
  ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS,
  EChartsHostController,
} from '../../helpers/echarts-host-controller';
import {
  DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
  isEChartsMobileTooltipViewport,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn,
} from '../../helpers/echarts-tooltip-interaction.helper';
import { resolveEChartsThemeName } from '../../helpers/echarts-theme.helper';
import { AppColors } from '../../services/color/app.colors';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

type ChartOption = Parameters<EChartsType['setOption']>[0];
type SleepStageValueKey = 'deepSeconds' | 'lightSeconds' | 'remSeconds' | 'unknownSeconds' | 'awakeSeconds';

interface SleepStageDefinition {
  key: SleepStageValueKey;
  label: string;
  color: AppColors;
  metricField: typeof SLEEP_SPORTS_LIB_METRIC_FIELDS[keyof typeof SLEEP_SPORTS_LIB_METRIC_FIELDS];
}

interface SleepStageView extends SleepStageDefinition {
  seconds: number;
  valueText: string;
}

const SLEEP_STAGE_DEFINITIONS: readonly SleepStageDefinition[] = [
  {
    key: 'deepSeconds',
    label: 'Deep',
    color: AppColors.DeepBlue,
    metricField: SLEEP_SPORTS_LIB_METRIC_FIELDS.DeepDuration,
  },
  {
    key: 'lightSeconds',
    label: 'Light',
    color: AppColors.LightBlue,
    metricField: SLEEP_SPORTS_LIB_METRIC_FIELDS.LightDuration,
  },
  {
    key: 'remSeconds',
    label: 'REM',
    color: AppColors.Purple,
    metricField: SLEEP_SPORTS_LIB_METRIC_FIELDS.RemDuration,
  },
  {
    key: 'unknownSeconds',
    label: 'Unknown',
    color: AppColors.MediumGray,
    metricField: SLEEP_SPORTS_LIB_METRIC_FIELDS.UnknownDuration,
  },
  {
    key: 'awakeSeconds',
    label: 'Awake',
    color: AppColors.Orange,
    metricField: SLEEP_SPORTS_LIB_METRIC_FIELDS.AwakeDuration,
  },
];

@Component({
  selector: 'app-health-sleep-stage-summary',
  standalone: true,
  template: `
    @if (hasStageData) {
      <div class="sleep-stage-summary">
        <div class="sleep-stage-heading">Sleep stages</div>
        <div
          #chartDiv
          class="sleep-stage-chart"
          role="img"
          [attr.aria-label]="chartAriaLabel">
        </div>
        <div class="sleep-stage-legend" aria-hidden="true">
          @for (stage of stages; track stage.key) {
            <span class="sleep-stage-legend-item">
              <span class="sleep-stage-swatch" [style.backgroundColor]="stage.color"></span>
              <span>{{ stage.label }}</span>
              <strong>{{ stage.valueText }}</strong>
            </span>
          }
        </div>
      </div>
    } @else {
      <p class="sleep-stage-unavailable">Sleep stages were not provided for this session.</p>
    }
  `,
  styleUrls: ['./health-sleep-stage-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthSleepStageSummaryComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) point!: DashboardSleepTrendPoint;
  @Input({ required: true }) sourceLabel!: string;
  @Input() darkTheme = false;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
  @ViewChild('chartDiv') chartDiv?: ElementRef<HTMLDivElement>;

  stages: readonly SleepStageView[] = [];
  hasStageData = false;
  chartAriaLabel = 'Sleep stage data unavailable.';

  private readonly chartHost: EChartsHostController;
  private viewInitialized = false;

  constructor(eChartsLoader: EChartsLoaderService, logger: LoggerService) {
    this.chartHost = new EChartsHostController({
      eChartsLoader,
      logger,
      logPrefix: '[HealthSleepStageSummaryComponent]',
      mobileTapFeedbackOptions: DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.viewInitialized = true;
    await this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.point || changes.sourceLabel || changes.unitSettings) {
      this.updateStageView();
    }
    if (this.viewInitialized && (changes.point || changes.sourceLabel || changes.darkTheme || changes.unitSettings)) {
      void this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.viewInitialized = false;
    this.chartHost.dispose();
  }

  private updateStageView(): void {
    if (!this.point) {
      this.stages = [];
      this.hasStageData = false;
      this.chartAriaLabel = 'Sleep stage data unavailable.';
      return;
    }

    const knownStageSeconds = this.point.deepSeconds
      + this.point.lightSeconds
      + this.point.remSeconds
      + this.point.awakeSeconds;
    this.hasStageData = knownStageSeconds > 0;
    this.stages = this.hasStageData
      ? SLEEP_STAGE_DEFINITIONS
        .map(stage => ({
          ...stage,
          seconds: this.finiteSeconds(this.point[stage.key]),
          valueText: this.formatDuration(stage.metricField, this.point[stage.key]),
        }))
        .filter(stage => stage.seconds > 0)
      : [];
    this.chartAriaLabel = this.hasStageData
      ? `${this.sourceLabel || this.point.providerLabel} sleep stages. ${this.stages.map(stage => `${stage.label} ${stage.valueText}`).join(', ')}.`
      : 'Sleep stage data unavailable.';
  }

  private async refresh(): Promise<void> {
    this.updateStageView();
    if (!this.viewInitialized || !this.hasStageData) {
      this.chartHost.dispose();
      return;
    }

    await Promise.resolve();
    const element = this.chartDiv?.nativeElement;
    if (!element || !this.viewInitialized) {
      return;
    }
    const chart = await this.chartHost.init(element, resolveEChartsThemeName(this.darkTheme));
    if (!chart || !this.viewInitialized) {
      return;
    }
    this.chartHost.hideTooltip();
    this.chartHost.setOption(this.buildOption(element.clientWidth || 0), ECHARTS_CARTESIAN_IMMEDIATE_UPDATE_SETTINGS);
    this.chartHost.scheduleResize();
  }

  private buildOption(chartWidth: number): ChartOption {
    const style = buildDashboardEChartsStyleTokens(this.darkTheme, chartWidth);
    const isMobileTooltipViewport = isEChartsMobileTooltipViewport();
    const totalSeconds = this.stages.reduce((total, stage) => total + stage.seconds, 0);
    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      tooltip: {
        show: true,
        trigger: 'item',
        triggerOn: resolveEChartsTooltipTriggerOn(true, isMobileTooltipViewport),
        renderMode: 'html',
        ...resolveEChartsTooltipSurfaceConfig(isMobileTooltipViewport),
        ...buildDashboardEChartsTooltipChrome(style),
        formatter: () => renderDashboardEChartsTooltipCard(style, {
          title: 'Sleep stages',
          subtitle: this.sourceLabel || this.point.providerLabel,
          rows: this.stages.map(stage => ({
            label: stage.label,
            value: stage.valueText,
            markerColor: stage.color,
          })),
        }),
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: totalSeconds,
        show: false,
      },
      yAxis: {
        type: 'category',
        data: ['Sleep'],
        show: false,
      },
      series: this.stages.map((stage, index) => ({
        name: stage.label,
        type: 'bar',
        stack: 'sleep-stages',
        barWidth: 18,
        emphasis: { focus: 'none' },
        itemStyle: {
          color: stage.color,
          borderRadius: index === 0
            ? [9, 0, 0, 9]
            : index === this.stages.length - 1
              ? [0, 9, 9, 0]
              : 0,
        },
        data: [stage.seconds],
      })),
    };
  }

  private formatDuration(
    field: typeof SLEEP_SPORTS_LIB_METRIC_FIELDS[keyof typeof SLEEP_SPORTS_LIB_METRIC_FIELDS],
    seconds: number,
  ): string {
    const display = formatCanonicalSleepMetricSportsLibValue(field, this.finiteSeconds(seconds), this.unitSettings, {
      compactDuration: true,
    });
    return display ? [display.value, display.unit].filter(Boolean).join(' ') : '—';
  }

  private finiteSeconds(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }
}
