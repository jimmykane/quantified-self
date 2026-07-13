import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, computed } from '@angular/core';
import { AppThemes } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { AppAuthService } from '../../authentication/app.auth.service';
import type {
  DashboardTrainingCapacityMetric,
  DashboardTrainingDisciplineSummary,
} from '../../helpers/dashboard-derived-metrics.helper';
import {
  buildDashboardPowerCurveContextFromSnapshot,
  type DashboardPowerCurveContext,
} from '../../helpers/dashboard-power-curve.helper';
import {
  buildDashboardSleepTrendContext,
  formatSleepDuration,
  type DashboardSleepTrendContext,
} from '../../helpers/dashboard-sleep-chart.helper';
import {
  buildTrainingAnalysis,
  type TrainingAnalysisInsight,
  type TrainingAnalysis,
  type TrainingComparisonState,
  type TrainingWindowComparison,
  resolveTrainingComparisonState,
} from '../../helpers/training-analysis.helper';
import { AppSleepService } from '../../services/app.sleep.service';
import { AppThemeService } from '../../services/app.theme.service';
import {
  DashboardDerivedMetricsService,
  createDashboardDerivedMetricsMissingState,
  type DashboardDerivedMetricsState,
} from '../../services/dashboard-derived-metrics.service';
import type { SleepSession } from '@shared/sleep';

interface CapacityMetricViewModel {
  label: string;
  metric: DashboardTrainingCapacityMetric;
  latestValueText: string;
  trendLabel: string;
  sourceKey: string | null;
}

interface TrainingMixDisciplineViewModel {
  summary: DashboardTrainingDisciplineSummary;
  currentZoneSeconds: number;
  baselineZoneSeconds: number;
  activityCountText: string;
  durationText: string;
  easyText: string;
  moderateText: string;
  hardText: string;
  baselineEasyText: string;
  baselineModerateText: string;
  baselineHardText: string;
}

interface TrainingCapacityDisciplineViewModel {
  summary: DashboardTrainingDisciplineSummary;
  metrics: CapacityMetricViewModel[];
}

interface TrainingStatusViewModel {
  stateLabel: string;
  stateCaption: string;
  volumeText: string;
  volumeCaption: string;
  sessionsText: string;
  sessionsCaption: string;
}

interface TrainingLoadMetricsViewModel {
  ctlText: string;
  atlText: string;
  rampText: string;
  acwrText: string;
  monotonyText: string;
  strainText: string;
  freshnessNowText: string;
  freshnessPlusSevenDaysText: string;
}

const TRAINING_SLEEP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function createEmptyTrainingStatusViewModel(): TrainingStatusViewModel {
  return {
    stateLabel: 'Awaiting data',
    stateCaption: 'No current load signals',
    volumeText: '--',
    volumeCaption: 'Preparing your training comparison…',
    sessionsText: '--',
    sessionsCaption: 'Preparing your training comparison…',
  };
}

function createEmptyTrainingLoadMetricsViewModel(): TrainingLoadMetricsViewModel {
  return {
    ctlText: '--',
    atlText: '--',
    rampText: '--',
    acwrText: '--',
    monotonyText: '--',
    strainText: '--',
    freshnessNowText: '--',
    freshnessPlusSevenDaysText: '--',
  };
}

@Component({
  selector: 'app-training-workspace',
  templateUrl: './training-workspace.component.html',
  styleUrls: ['./training-workspace.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TrainingWorkspaceComponent implements OnInit, OnDestroy {
  public isLoading = true;
  public derivedState: DashboardDerivedMetricsState = createDashboardDerivedMetricsMissingState();
  public sleepTrend: DashboardSleepTrendContext | null = null;
  public cyclingPowerCurve: DashboardPowerCurveContext | null = null;
  public runningPowerCurve: DashboardPowerCurveContext | null = null;
  public trainingStatus = createEmptyTrainingStatusViewModel();
  public trainingComparisonState: TrainingComparisonState = 'preparing';
  public trainingInsights: TrainingAnalysisInsight[] = [];
  public loadMetrics = createEmptyTrainingLoadMetricsViewModel();
  public trainingMixDisciplines: TrainingMixDisciplineViewModel[] = [];
  public capacityDisciplines: TrainingCapacityDisciplineViewModel[] = [];
  public readonly isDarkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);

  private readonly subscriptions = new Subscription();
  private dataSubscriptions = new Subscription();
  private currentUserUID: string | null = null;

  constructor(
    private readonly authService: AppAuthService,
    private readonly derivedMetricsService: DashboardDerivedMetricsService,
    private readonly sleepService: AppSleepService,
    private readonly themeService: AppThemeService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(this.authService.user$.subscribe((user) => {
      const uid = `${user?.uid || ''}`.trim();
      if (uid === this.currentUserUID) {
        return;
      }

      this.currentUserUID = uid || null;
      this.dataSubscriptions.unsubscribe();
      this.dataSubscriptions = new Subscription();
      this.resetWorkspace();
      if (!user || !uid) {
        this.isLoading = false;
        this.changeDetector.markForCheck();
        return;
      }

      let hasReceivedDerivedState = false;
      this.dataSubscriptions.add(this.derivedMetricsService.watch(user).subscribe((state) => {
        hasReceivedDerivedState = true;
        this.applyDerivedState(state);
        this.isLoading = false;
        this.derivedMetricsService.ensureForDashboard(user, state);
        this.changeDetector.markForCheck();
      }));

      // Firestore can wait for every derived snapshot before emitting. Do not let that
      // block the workspace that requests the missing snapshots in the first place.
      if (!hasReceivedDerivedState) {
        this.isLoading = false;
        this.derivedMetricsService.ensureForDashboard(user, this.derivedState);
        this.changeDetector.markForCheck();
      }

      const endMs = Date.now();
      const startMs = endMs - TRAINING_SLEEP_WINDOW_MS;
      this.dataSubscriptions.add(this.sleepService
        .watchForDashboard(uid, startMs, endMs)
        .subscribe((sessions) => {
          this.sleepTrend = this.buildSleepTrend(sessions || [], startMs, endMs);
          this.refreshDerivedViewModels();
          this.changeDetector.markForCheck();
        }));
    }));
  }

  ngOnDestroy(): void {
    this.dataSubscriptions.unsubscribe();
    this.subscriptions.unsubscribe();
  }

  private formatNumber(value: number | null | undefined, fractionDigits = 1, signed = false): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '--';
    }
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${new Intl.NumberFormat(undefined, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(value)}`;
  }

  private formatPercent(numerator: number, denominator: number): string {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return '--';
    }
    return `${this.formatNumber((numerator / denominator) * 100, 0)}%`;
  }

  private resolveCapacityMetrics(discipline: DashboardTrainingDisciplineSummary): CapacityMetricViewModel[] {
    return [
      { label: 'Device VO2 Max', metric: discipline.vo2Max },
      { label: 'FTP', metric: discipline.ftp },
      { label: 'Critical power', metric: discipline.criticalPower },
    ].filter((item): item is { label: string; metric: DashboardTrainingCapacityMetric } => item.metric !== null)
      .map((item) => ({
        ...item,
        latestValueText: this.formatNumber(item.metric.latestValue),
        trendLabel: resolveCapacityTrendLabel(item.metric),
        sourceKey: item.metric.sourceKey,
      }));
  }

  private resetWorkspace(): void {
    this.isLoading = true;
    this.derivedState = createDashboardDerivedMetricsMissingState();
    this.sleepTrend = null;
    this.cyclingPowerCurve = null;
    this.runningPowerCurve = null;
    this.trainingStatus = createEmptyTrainingStatusViewModel();
    this.trainingComparisonState = 'preparing';
    this.trainingInsights = [];
    this.loadMetrics = createEmptyTrainingLoadMetricsViewModel();
    this.trainingMixDisciplines = [];
    this.capacityDisciplines = [];
  }

  private applyDerivedState(state: DashboardDerivedMetricsState): void {
    this.derivedState = state;
    this.cyclingPowerCurve = buildDashboardPowerCurveContextFromSnapshot(state.powerCurve, {
      scope: 'cycling',
      range: 'all',
      latestSeriesLabel: 'Latest cycling activity',
    });
    this.runningPowerCurve = buildDashboardPowerCurveContextFromSnapshot(state.powerCurve, {
      scope: 'running',
      range: 'all',
      latestSeriesLabel: 'Latest running activity',
    });
    this.refreshDerivedViewModels();
    const summaries = state.trainingSummary?.disciplines || [];
    this.trainingMixDisciplines = summaries
      .map((summary) => {
        const currentZoneSeconds = resolveTrainingZoneSeconds(summary.current28d);
        const baselineZoneSeconds = resolveTrainingZoneSeconds(summary.baseline28d);
        return {
          summary,
          currentZoneSeconds,
          baselineZoneSeconds,
          activityCountText: this.formatNumber(summary.current28d.activityCount, 0),
          durationText: formatSleepDuration(summary.current28d.durationSeconds),
          easyText: this.formatPercent(summary.current28d.easySeconds, currentZoneSeconds),
          moderateText: this.formatPercent(summary.current28d.moderateSeconds, currentZoneSeconds),
          hardText: this.formatPercent(summary.current28d.hardSeconds, currentZoneSeconds),
          baselineEasyText: this.formatPercent(summary.baseline28d.easySeconds, baselineZoneSeconds),
          baselineModerateText: this.formatPercent(summary.baseline28d.moderateSeconds, baselineZoneSeconds),
          baselineHardText: this.formatPercent(summary.baseline28d.hardSeconds, baselineZoneSeconds),
        };
      })
      .filter(view => view.summary.current28d.activityCount > 0 || view.summary.baseline28d.activityCount > 0);
    this.capacityDisciplines = summaries
      .map((summary) => ({ summary, metrics: this.resolveCapacityMetrics(summary) }))
      .filter(view => view.metrics.length > 0);
  }

  private getLatestFormPoint() {
    const points = this.derivedState.formPoints || [];
    return points.length ? points[points.length - 1] : null;
  }

  private refreshDerivedViewModels(): void {
    const latestFormPoint = this.getLatestFormPoint();
    const analysis = buildTrainingAnalysis({
      disciplines: this.derivedState.trainingSummary?.disciplines || [],
      stateSignals: {
      form: this.derivedState.formNow?.value ?? latestFormPoint?.formSameDay ?? null,
      rampRate: this.derivedState.rampRate?.rampRate ?? null,
      fitness: latestFormPoint?.ctl ?? null,
      fatigue: latestFormPoint?.atl ?? null,
      },
    });
    const forecastPoints = this.derivedState.freshnessForecast?.points || [];
    const latestCurrentPoint = [...forecastPoints].reverse().find(point => !point.isForecast);
    const finalForecastPoint = [...forecastPoints].reverse().find(point => point.isForecast);

    this.trainingComparisonState = resolveTrainingComparisonState(
      this.derivedState.trainingSummaryStatus,
      !!this.derivedState.trainingSummary,
      analysis.activities.current,
      analysis.activities.baseline,
    );
    this.trainingStatus = this.buildTrainingStatus(analysis, this.trainingComparisonState);
    this.trainingInsights = analysis.insights;
    this.loadMetrics = {
      ctlText: this.formatNumber(latestFormPoint?.ctl),
      atlText: this.formatNumber(latestFormPoint?.atl),
      rampText: this.formatNumber(this.derivedState.rampRate?.rampRate, 2, true),
      acwrText: this.formatNumber(this.derivedState.acwr?.ratio, 2),
      monotonyText: this.formatNumber(this.derivedState.monotonyStrain?.monotony, 2),
      strainText: this.formatNumber(this.derivedState.monotonyStrain?.strain, 0),
      freshnessNowText: this.formatNumber(latestCurrentPoint?.formSameDay ?? this.derivedState.formNow?.value, 1, true),
      freshnessPlusSevenDaysText: this.formatNumber(finalForecastPoint?.formSameDay ?? this.derivedState.formPlus7d?.value, 1, true),
    };
  }

  private buildTrainingStatus(
    analysis: TrainingAnalysis,
    comparisonState: TrainingComparisonState,
  ): TrainingStatusViewModel {
    const currentState = {
      stateLabel: analysis.state.label || 'Awaiting data',
      stateCaption: analysis.state.caption || 'No current load signals',
    };
    if (comparisonState === 'preparing') {
      return {
        ...currentState,
        volumeText: '--',
        volumeCaption: 'Preparing your training comparison…',
        sessionsText: '--',
        sessionsCaption: 'Preparing your training comparison…',
      };
    }
    if (comparisonState === 'unavailable') {
      return {
        ...currentState,
        volumeText: '--',
        volumeCaption: 'Training comparison unavailable',
        sessionsText: '--',
        sessionsCaption: 'Training comparison unavailable',
      };
    }
    if (comparisonState === 'updating') {
      return {
        ...currentState,
        volumeText: analysis.duration.current > 0 ? formatSleepDuration(analysis.duration.current) : '0h',
        volumeCaption: 'Updating your training comparison…',
        sessionsText: `${this.formatNumber(analysis.activities.current, 0)} sessions`,
        sessionsCaption: 'Updating your training comparison…',
      };
    }
    if (comparisonState === 'empty') {
      return {
        ...currentState,
        volumeText: '0h',
        volumeCaption: 'No eligible running or cycling sessions in the last 28 days',
        sessionsText: '0 sessions',
        sessionsCaption: 'No eligible running or cycling sessions in the last 28 days',
      };
    }
    return {
      ...currentState,
      volumeText: analysis.duration.current > 0 ? formatSleepDuration(analysis.duration.current) : '0h',
      volumeCaption: this.formatVolumeComparison(analysis.duration),
      sessionsText: `${this.formatNumber(analysis.activities.current, 0)} sessions`,
      sessionsCaption: this.formatSessionsComparison(analysis.activities),
    };
  }

  private formatVolumeComparison(comparison: TrainingWindowComparison): string {
    if (comparison.deltaPercent === null) {
      return comparison.current > 0 ? 'Baseline builds with more history' : 'No baseline comparison yet';
    }
    if (Math.abs(comparison.deltaPercent) < 10) {
      return 'In line with your usual 28 days';
    }
    const direction = comparison.deltaPercent > 0 ? 'above' : 'below';
    return `${this.formatNumber(Math.abs(comparison.deltaPercent), 0)}% ${direction} your usual 28 days`;
  }

  private formatSessionsComparison(comparison: TrainingWindowComparison): string {
    if (comparison.baseline <= 0) {
      return comparison.current > 0 ? 'Baseline builds with more history' : 'No baseline comparison yet';
    }
    if (Math.abs(comparison.delta) < 2) {
      return 'In line with your usual 28 days';
    }
    const direction = comparison.delta > 0 ? 'more' : 'fewer';
    return `${this.formatNumber(Math.abs(comparison.delta), 0)} ${direction} than usual`;
  }

  private buildSleepTrend(sessions: SleepSession[], startMs: number, endMs: number): DashboardSleepTrendContext {
    return buildDashboardSleepTrendContext(sessions, {
      nowMs: endMs,
      sleepWindow: { startMs, endMs },
    });
  }

}

function resolveTrainingZoneSeconds(
  summary: DashboardTrainingDisciplineSummary['current28d'],
): number {
  return summary.easySeconds + summary.moderateSeconds + summary.hardSeconds;
}

function resolveCapacityTrendLabel(metric: DashboardTrainingCapacityMetric): string {
  if (metric.trend === 'improving') {
    return 'Improving';
  }
  if (metric.trend === 'declining') {
    return 'Declining';
  }
  if (metric.trend === 'stable') {
    return 'Stable';
  }
  return 'No source-matched trend';
}
