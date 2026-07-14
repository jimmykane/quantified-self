import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, computed } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AppThemes, DataDistance, DataSwimDistance, SwimPaceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { Subscription } from 'rxjs';
import { AppAuthService } from '../../authentication/app.auth.service';
import type {
  DashboardTrainingBuildComparisonDiscipline,
  DashboardTrainingDisciplineSummary,
} from '../../helpers/dashboard-derived-metrics.helper';
import {
  buildTrainingCapacityViewModels,
  type TrainingCapacityDisciplineViewModel,
} from '../../helpers/training-capacity.helper';
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import {
  getTrainingBuildBenchmarkSelectionKey,
  isTrainingVisibleDiscipline,
  normalizeTrainingVisibleDisciplines,
  TRAINING_VISIBLE_DISCIPLINES,
  type DerivedTrainingDiscipline,
  type TrainingBuildBenchmarkSelection,
  type TrainingSettings,
  type TrainingVisibleDiscipline,
} from '@shared/derived-metrics';
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
  TrainingBuildBenchmarkDialogComponent,
  type TrainingBuildEventSuggestionsState,
} from './training-build-benchmark-dialog.component';
import {
  TrainingSportVisibilityDialogComponent,
  type TrainingSportVisibilityDialogResult,
} from './training-sport-visibility-dialog.component';
import {
  formatTrainingVisibleDisciplinesActivityLabel,
  formatTrainingVisibleDisciplinesAccessibleLabel,
  formatTrainingVisibleDisciplinesCompactLabel,
  formatTrainingVisibleDisciplinesLabel,
  resolveTrainingSportVisibility,
  trainingSportVisibilitySelectionKey,
} from '../../helpers/training-sport-visibility.helper';
import { formatTrainingSwimPace } from '../../helpers/training-swim-performance.helper';
import {
  DashboardDerivedMetricsService,
  createDashboardDerivedMetricsMissingState,
  TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
  type DashboardDerivedMetricsState,
} from '../../services/dashboard-derived-metrics.service';
import type { SleepSession } from '@shared/sleep';

interface TrainingMixDisciplineViewModel {
  summary: DashboardTrainingDisciplineSummary;
  label: string;
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

type TrainingBuildCardState = 'not-configured' | 'updating' | 'invalid' | 'unavailable' | 'ready';

interface TrainingBuildCardViewModel {
  discipline: DerivedTrainingDiscipline;
  label: string;
  state: TrainingBuildCardState;
  source: DashboardTrainingBuildComparisonDiscipline | null;
  expectedSelection: TrainingBuildBenchmarkSelection | null;
  referenceText: string;
  rangeText: string;
  emptyMessage: string | null;
  metricRows: TrainingBuildMetricRowViewModel[];
}

interface TrainingBuildMetricRowViewModel {
  label: string;
  currentText: string;
  benchmarkText: string;
  deltaText: string;
  isIntensity: boolean;
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
  public trainingBuildCards: TrainingBuildCardViewModel[] = [];
  public visibleDisciplines: TrainingVisibleDiscipline[] = [...TRAINING_VISIBLE_DISCIPLINES];
  public visibleDisciplinesCompactLabel = formatTrainingVisibleDisciplinesCompactLabel(this.visibleDisciplines);
  public visibleDisciplinesAccessibleLabel = formatTrainingVisibleDisciplinesAccessibleLabel(this.visibleDisciplines, true);
  public visibleDisciplinesActivityLabel = formatTrainingVisibleDisciplinesActivityLabel(this.visibleDisciplines);
  public isAutomaticSportVisibility = true;
  public isRunningVisible = true;
  public isCyclingVisible = true;
  public isSwimmingVisible = true;
  public hasPowerCapacityVisible = true;
  public readonly isDarkTheme = computed(() => this.themeService.appTheme() === AppThemes.Dark);

  private readonly subscriptions = new Subscription();
  private dataSubscriptions = new Subscription();
  private currentUserUID: string | null = null;
  private trainingSettings: TrainingSettings = {};
  public unitSettings: UserUnitSettingsInterface | null = null;
  private pendingTrainingBuildSelections = new Map<DerivedTrainingDiscipline, TrainingBuildBenchmarkSelection | null>();
  private pendingTrainingVisibleDisciplines: TrainingVisibleDiscipline[] | null | undefined;
  private pendingTrainingVisibleDisciplinesBaselineKey: string | undefined;
  private trainingBuildBenchmarkDialogRef: MatDialogRef<TrainingBuildBenchmarkDialogComponent> | null = null;
  private trainingBuildBenchmarkDialogDiscipline: DerivedTrainingDiscipline | null = null;
  private trainingSportVisibilityDialogRef: MatDialogRef<TrainingSportVisibilityDialogComponent> | null = null;

  constructor(
    private readonly authService: AppAuthService,
    private readonly derivedMetricsService: DashboardDerivedMetricsService,
    private readonly sleepService: AppSleepService,
    private readonly themeService: AppThemeService,
    private readonly dialog: MatDialog,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(this.authService.user$.subscribe((user) => {
      const uid = `${user?.uid || ''}`.trim();
      if (uid === this.currentUserUID) {
        this.trainingSettings = user?.settings?.trainingSettings || {};
        this.reconcilePendingTrainingSportVisibility();
        this.unitSettings = user?.settings?.unitSettings || null;
        this.refreshSportSpecificViewModels();
        this.changeDetector.markForCheck();
        return;
      }

      this.currentUserUID = uid || null;
      this.dataSubscriptions.unsubscribe();
      this.dataSubscriptions = new Subscription();
      this.resetWorkspace();
      this.trainingSettings = user?.settings?.trainingSettings || {};
      this.unitSettings = user?.settings?.unitSettings || null;
      this.refreshSportSpecificViewModels();
      if (!user || !uid) {
        this.isLoading = false;
        this.changeDetector.markForCheck();
        return;
      }

      let hasReceivedDerivedState = false;
      const metricScope = { metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS };
      this.dataSubscriptions.add(this.derivedMetricsService.watch(user, metricScope).subscribe((state) => {
        hasReceivedDerivedState = true;
        this.applyDerivedState(state);
        this.isLoading = false;
        this.derivedMetricsService.ensureForDashboard(user, state, metricScope);
        this.changeDetector.markForCheck();
      }));

      // Firestore can wait for every derived snapshot before emitting. Do not let that
      // block the workspace that requests the missing snapshots in the first place.
      if (!hasReceivedDerivedState) {
        this.isLoading = false;
        this.derivedMetricsService.ensureForDashboard(user, this.derivedState, metricScope);
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

  private resetWorkspace(): void {
    const activeDialogRef = this.trainingBuildBenchmarkDialogRef;
    const activeVisibilityDialogRef = this.trainingSportVisibilityDialogRef;
    this.trainingBuildBenchmarkDialogRef = null;
    this.trainingBuildBenchmarkDialogDiscipline = null;
    this.trainingSportVisibilityDialogRef = null;
    activeDialogRef?.close();
    activeVisibilityDialogRef?.close();
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
    this.trainingSettings = {};
    this.unitSettings = null;
    this.pendingTrainingBuildSelections.clear();
    this.pendingTrainingVisibleDisciplines = undefined;
    this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
    this.visibleDisciplines = [...TRAINING_VISIBLE_DISCIPLINES];
    this.visibleDisciplinesCompactLabel = formatTrainingVisibleDisciplinesCompactLabel(this.visibleDisciplines);
    this.visibleDisciplinesAccessibleLabel = formatTrainingVisibleDisciplinesAccessibleLabel(this.visibleDisciplines, true);
    this.visibleDisciplinesActivityLabel = formatTrainingVisibleDisciplinesActivityLabel(this.visibleDisciplines);
    this.isAutomaticSportVisibility = true;
    this.isRunningVisible = true;
    this.isCyclingVisible = true;
    this.isSwimmingVisible = true;
    this.hasPowerCapacityVisible = true;
    this.trainingBuildCards = this.buildTrainingBuildCards();
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
    this.refreshSportSpecificViewModels();
  }

  private refreshSportSpecificViewModels(): void {
    this.refreshTrainingSportVisibility();
    if (
      this.trainingBuildBenchmarkDialogRef
      && this.trainingBuildBenchmarkDialogDiscipline
      && (
        !isTrainingVisibleDiscipline(this.trainingBuildBenchmarkDialogDiscipline)
        || !this.visibleDisciplines.includes(this.trainingBuildBenchmarkDialogDiscipline)
      )
    ) {
      const dialogRef = this.trainingBuildBenchmarkDialogRef;
      this.trainingBuildBenchmarkDialogRef = null;
      this.trainingBuildBenchmarkDialogDiscipline = null;
      dialogRef.close();
    }
    const summaries = this.derivedState.trainingSummary?.disciplines || [];
    this.trainingMixDisciplines = summaries
      .filter(summary => isTrainingVisibleDiscipline(summary.discipline))
      .map((summary) => {
        const currentZoneSeconds = resolveTrainingZoneSeconds(summary.current28d);
        const baselineZoneSeconds = resolveTrainingZoneSeconds(summary.baseline28d);
        return {
          summary,
          label: formatTrainingVisibleDisciplinesLabel([summary.discipline]),
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
      .filter(view => this.visibleDisciplines.includes(view.summary.discipline))
      .filter(view => view.summary.current28d.activityCount > 0 || view.summary.baseline28d.activityCount > 0);
    this.capacityDisciplines = buildTrainingCapacityViewModels(this.derivedState.trainingCapacity)
      .filter(view => isTrainingVisibleDiscipline(view.discipline) && this.visibleDisciplines.includes(view.discipline));
    this.refreshTrainingBuildCards();
  }

  private refreshTrainingSportVisibility(): void {
    const preference = this.pendingTrainingVisibleDisciplines !== undefined
      ? this.pendingTrainingVisibleDisciplines
      : this.trainingSettings.visibleDisciplines;
    const resolution = resolveTrainingSportVisibility(
      preference,
      this.derivedState.trainingSummary,
      this.derivedState.trainingSummaryStatus === 'ready',
      this.trainingSettings.buildBenchmarks,
    );
    this.visibleDisciplines = resolution.disciplines;
    this.isAutomaticSportVisibility = resolution.isAutomatic;
    this.isRunningVisible = resolution.disciplines.includes('running');
    this.isCyclingVisible = resolution.disciplines.includes('cycling');
    this.isSwimmingVisible = resolution.disciplines.includes('swimming');
    this.hasPowerCapacityVisible = this.isRunningVisible || this.isCyclingVisible;
    this.visibleDisciplinesCompactLabel = formatTrainingVisibleDisciplinesCompactLabel(resolution.disciplines);
    this.visibleDisciplinesAccessibleLabel = formatTrainingVisibleDisciplinesAccessibleLabel(
      resolution.disciplines,
      resolution.isAutomatic,
    );
    this.visibleDisciplinesActivityLabel = formatTrainingVisibleDisciplinesActivityLabel(resolution.disciplines);
  }

  private reconcilePendingTrainingSportVisibility(): void {
    if (this.pendingTrainingVisibleDisciplines === undefined) {
      this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
      return;
    }
    const persistedKey = this.resolvePersistedTrainingSportVisibilityKey();
    if (
      this.isPersistedTrainingSportVisibility(this.pendingTrainingVisibleDisciplines)
      || (
        this.pendingTrainingVisibleDisciplinesBaselineKey !== undefined
        && persistedKey !== this.pendingTrainingVisibleDisciplinesBaselineKey
      )
    ) {
      this.pendingTrainingVisibleDisciplines = undefined;
      this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
    }
  }

  private isPersistedTrainingSportVisibility(
    preference: readonly TrainingVisibleDiscipline[] | null,
  ): boolean {
    return this.resolvePersistedTrainingSportVisibilityKey()
      === trainingSportVisibilitySelectionKey(preference);
  }

  private resolvePersistedTrainingSportVisibilityKey(): string {
    return trainingSportVisibilitySelectionKey(
      normalizeTrainingVisibleDisciplines(this.trainingSettings.visibleDisciplines),
    );
  }

  public openTrainingSportVisibilityDialog(): void {
    if (this.trainingSportVisibilityDialogRef || this.trainingBuildBenchmarkDialogRef) {
      return;
    }
    const dialogRef = this.dialog.open(TrainingSportVisibilityDialogComponent, {
      width: 'min(100vw - 32px, 480px)',
      maxWidth: '480px',
      data: {
        visibleDisciplines: [...this.visibleDisciplines],
        isAutomatic: this.isAutomaticSportVisibility,
      },
    });
    this.trainingSportVisibilityDialogRef = dialogRef;
    this.subscriptions.add(dialogRef.afterClosed().subscribe((result: TrainingSportVisibilityDialogResult | undefined) => {
      if (this.trainingSportVisibilityDialogRef === dialogRef) {
        this.trainingSportVisibilityDialogRef = null;
      }
      if (!result?.saved) {
        return;
      }
      if (this.isPersistedTrainingSportVisibility(result.visibleDisciplines)) {
        this.pendingTrainingVisibleDisciplines = undefined;
        this.pendingTrainingVisibleDisciplinesBaselineKey = undefined;
      } else {
        this.pendingTrainingVisibleDisciplinesBaselineKey = this.resolvePersistedTrainingSportVisibilityKey();
        this.pendingTrainingVisibleDisciplines = result.visibleDisciplines;
      }
      this.refreshSportSpecificViewModels();
      this.changeDetector.markForCheck();
    }));
  }

  public openTrainingBuildBenchmarkDialog(discipline: DerivedTrainingDiscipline): void {
    if (this.trainingBuildBenchmarkDialogRef || this.trainingSportVisibilityDialogRef) {
      return;
    }
    const card = this.trainingBuildCards.find(item => item.discipline === discipline);
    const selection = this.resolveEffectiveTrainingBuildSelection(discipline);
    const dialogRef = this.dialog.open(TrainingBuildBenchmarkDialogComponent, {
      width: '720px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
      data: {
        discipline,
        asOfDayMs: this.derivedState.trainingBuildComparison?.asOfDayMs ?? this.resolveCurrentUtcDayMs(),
        suggestedRaces: card?.source?.suggestedRaces || [],
        suggestedEvents: card?.source?.suggestedEvents || [],
        eventSuggestionsState: this.resolveTrainingBuildEventSuggestionsState(card?.source || null),
        selection,
        unitSettings: this.unitSettings,
      },
    });
    this.trainingBuildBenchmarkDialogRef = dialogRef;
    this.trainingBuildBenchmarkDialogDiscipline = discipline;
    this.subscriptions.add(dialogRef.afterClosed().subscribe((result: { saved?: boolean; selection?: TrainingBuildBenchmarkSelection | null } | undefined) => {
      if (this.trainingBuildBenchmarkDialogRef === dialogRef) {
        this.trainingBuildBenchmarkDialogRef = null;
        this.trainingBuildBenchmarkDialogDiscipline = null;
      }
      if (!result?.saved) {
        return;
      }
      this.pendingTrainingBuildSelections.set(discipline, result.selection ?? null);
      this.refreshTrainingBuildCards();
      this.changeDetector.markForCheck();
    }));
  }

  private resolveTrainingBuildEventSuggestionsState(
    source: DashboardTrainingBuildComparisonDiscipline | null,
  ): TrainingBuildEventSuggestionsState {
    if (source) {
      return 'ready';
    }
    return this.derivedState.trainingBuildComparisonStatus === 'failed'
      ? 'unavailable'
      : 'loading';
  }

  private formatTrainingBuildDistance(
    value: number | null | undefined,
    discipline: DerivedTrainingDiscipline = 'running',
  ): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return '--';
    }
    const distance = discipline === 'swimming' ? new DataSwimDistance(value) : new DataDistance(value);
    const formattedDistance = resolveUnitAwareDisplayStat(distance, this.unitSettings, { stripRepeatedUnit: true })?.text;
    if (formattedDistance) {
      return formattedDistance;
    }
    return discipline === 'swimming'
      ? `${this.formatNumber(value, 0)} m`
      : `${this.formatNumber(value / 1000, 1)} km`;
  }

  private formatTrainingBuildDuration(value: number | null | undefined): string {
    return value === null || value === undefined || !Number.isFinite(value) ? '--' : formatSleepDuration(value);
  }

  private formatTrainingBuildDistanceDelta(
    current: number | null | undefined,
    benchmark: number | null | undefined,
    discipline: DerivedTrainingDiscipline,
  ): string {
    if (current === null || current === undefined || benchmark === null || benchmark === undefined) {
      return '--';
    }
    const delta = current - benchmark;
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${this.formatTrainingBuildDistance(Math.abs(delta), discipline)}`;
  }

  private formatTrainingBuildSwimPace(value: number | null | undefined): string {
    const usesYards = this.unitSettings?.swimPaceUnits?.[0] === SwimPaceUnits.MinutesPer100Yard;
    return formatTrainingSwimPace(value, usesYards);
  }

  private formatTrainingBuildSwimPaceDelta(
    current: number | null | undefined,
    benchmark: number | null | undefined,
  ): string {
    if (!Number.isFinite(current) || !Number.isFinite(benchmark)) {
      return '--';
    }
    const delta = (current as number) - (benchmark as number);
    if (Math.abs(delta) < 0.5) {
      return 'Same pace';
    }
    return `${this.formatTrainingBuildSwimPace(Math.abs(delta))} ${delta < 0 ? 'faster' : 'slower'}`;
  }

  private formatTrainingBuildNumber(value: number | null | undefined, fractionDigits = 0): string {
    return this.formatNumber(value, fractionDigits);
  }

  private formatTrainingBuildActiveWeeks(
    activeWeekCount: number | null | undefined,
    periodWeeks: number | null | undefined,
  ): string {
    if (
      activeWeekCount === null
      || activeWeekCount === undefined
      || periodWeeks === null
      || periodWeeks === undefined
      || !Number.isFinite(activeWeekCount)
      || !Number.isFinite(periodWeeks)
      || periodWeeks <= 0
    ) {
      return '--';
    }
    return `${this.formatTrainingBuildNumber(activeWeekCount)} / ${this.formatTrainingBuildNumber(periodWeeks)}`;
  }

  public formatTrainingBuildDelta(current: number | null | undefined, benchmark: number | null | undefined, fractionDigits = 0): string {
    if (current === null || current === undefined || benchmark === null || benchmark === undefined) {
      return '--';
    }
    return this.formatNumber(current - benchmark, fractionDigits, true);
  }

  public formatTrainingBuildDurationDelta(current: number | null | undefined, benchmark: number | null | undefined): string {
    if (current === null || current === undefined || benchmark === null || benchmark === undefined) {
      return '--';
    }
    const delta = current - benchmark;
    return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatSleepDuration(Math.abs(delta))}`;
  }

  private formatTrainingBuildIntensity(
    window: DashboardTrainingBuildComparisonDiscipline['current'] | null | undefined,
  ): string {
    if (!window || window.easySeconds === null || window.moderateSeconds === null || window.hardSeconds === null) {
      return '--';
    }
    const total = window.easySeconds + window.moderateSeconds + window.hardSeconds;
    if (total <= 0) {
      return '--';
    }
    return `E ${this.formatPercent(window.easySeconds, total)} · M ${this.formatPercent(window.moderateSeconds, total)} · H ${this.formatPercent(window.hardSeconds, total)}`;
  }

  private formatTrainingBuildReference(source: DashboardTrainingBuildComparisonDiscipline | null): string {
    const selection = source?.selection;
    if (!selection) {
      return '';
    }
    if (selection.mode === 'race') {
      return selection.label || 'Tagged race';
    }
    return 'Manual historical period';
  }

  private formatTrainingBuildRange(startDayMs: number | null | undefined, endDayMs: number | null | undefined): string {
    if (!Number.isFinite(startDayMs) || !Number.isFinite(endDayMs)) {
      return '';
    }
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return `${formatter.format(new Date(startDayMs as number))} – ${formatter.format(new Date(endDayMs as number))}`;
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

  private refreshTrainingBuildCards(): void {
    this.trainingBuildCards = this.buildTrainingBuildCards();
    this.syncTrainingBuildBenchmarkDialogSuggestions();
  }

  private syncTrainingBuildBenchmarkDialogSuggestions(): void {
    const dialogRef = this.trainingBuildBenchmarkDialogRef;
    const discipline = this.trainingBuildBenchmarkDialogDiscipline;
    if (!dialogRef || !discipline) {
      return;
    }
    const card = this.trainingBuildCards.find(item => item.discipline === discipline);
    dialogRef.componentInstance.updateEventSuggestions({
      asOfDayMs: this.derivedState.trainingBuildComparison?.asOfDayMs ?? this.resolveCurrentUtcDayMs(),
      suggestedRaces: card?.source?.suggestedRaces || [],
      suggestedEvents: card?.source?.suggestedEvents || [],
      state: this.resolveTrainingBuildEventSuggestionsState(card?.source || null),
    });
  }

  private buildTrainingBuildCards(): TrainingBuildCardViewModel[] {
    const contexts = this.derivedState.trainingBuildComparison?.disciplines || [];
    return TRAINING_VISIBLE_DISCIPLINES.filter(discipline => this.visibleDisciplines.includes(discipline)).map((discipline) => {
      const source = contexts.find(item => item.discipline === discipline) || null;
      const expectedSelection = this.resolveEffectiveTrainingBuildSelection(discipline);
      const state = this.resolveTrainingBuildCardState(discipline, source, expectedSelection);
      return {
        discipline,
        label: formatTrainingVisibleDisciplinesLabel([discipline]),
        state,
        source,
        expectedSelection,
        referenceText: this.formatTrainingBuildReference(source),
        rangeText: this.formatTrainingBuildRange(
          source?.selection?.windowStartDayMs,
          source?.selection?.windowEndDayMs,
        ),
        emptyMessage: this.resolveTrainingBuildEmptyMessage(source),
        metricRows: this.buildTrainingBuildMetricRows(source, discipline),
      };
    });
  }

  private resolveTrainingBuildEmptyMessage(source: DashboardTrainingBuildComparisonDiscipline | null): string | null {
    if (source?.current?.activityCount === 0) {
      return 'No eligible sessions in the current window.';
    }
    if (source?.benchmark?.activityCount === 0) {
      return 'No eligible sessions in the saved benchmark window.';
    }
    return null;
  }

  private buildTrainingBuildMetricRows(
    source: DashboardTrainingBuildComparisonDiscipline | null,
    discipline: DerivedTrainingDiscipline,
  ): TrainingBuildMetricRowViewModel[] {
    const current = source?.current;
    const benchmark = source?.benchmark;
    if (!current || !benchmark) {
      return [];
    }
    const rows: TrainingBuildMetricRowViewModel[] = [
      {
        label: 'Distance',
        currentText: this.formatTrainingBuildDistance(current.distanceMeters, discipline),
        benchmarkText: this.formatTrainingBuildDistance(benchmark.distanceMeters, discipline),
        deltaText: this.formatTrainingBuildDistanceDelta(current.distanceMeters, benchmark.distanceMeters, discipline),
        isIntensity: false,
      },
      {
        label: 'Time',
        currentText: this.formatTrainingBuildDuration(current.durationSeconds),
        benchmarkText: this.formatTrainingBuildDuration(benchmark.durationSeconds),
        deltaText: this.formatTrainingBuildDurationDelta(current.durationSeconds, benchmark.durationSeconds),
        isIntensity: false,
      },
      {
        label: 'Sessions',
        currentText: this.formatTrainingBuildNumber(current.activityCount),
        benchmarkText: this.formatTrainingBuildNumber(benchmark.activityCount),
        deltaText: this.formatTrainingBuildDelta(current.activityCount, benchmark.activityCount),
        isIntensity: false,
      },
      {
        label: 'Active weeks',
        currentText: this.formatTrainingBuildActiveWeeks(current.activeWeekCount, current.periodWeeks),
        benchmarkText: this.formatTrainingBuildActiveWeeks(benchmark.activeWeekCount, benchmark.periodWeeks),
        deltaText: this.formatTrainingBuildDelta(current.activeWeekCount, benchmark.activeWeekCount),
        isIntensity: false,
      },
      {
        label: 'Longest session',
        currentText: this.formatTrainingBuildDuration(current.longestActivityDurationSeconds),
        benchmarkText: this.formatTrainingBuildDuration(benchmark.longestActivityDurationSeconds),
        deltaText: this.formatTrainingBuildDurationDelta(
          current.longestActivityDurationSeconds,
          benchmark.longestActivityDurationSeconds,
        ),
        isIntensity: false,
      },
    ];
    if (discipline === 'swimming') {
      rows.push({
        label: 'Pool pace',
        currentText: this.formatTrainingBuildSwimPace(current.poolAveragePaceSecondsPer100m),
        benchmarkText: this.formatTrainingBuildSwimPace(benchmark.poolAveragePaceSecondsPer100m),
        deltaText: this.formatTrainingBuildSwimPaceDelta(
          current.poolAveragePaceSecondsPer100m,
          benchmark.poolAveragePaceSecondsPer100m,
        ),
        isIntensity: false,
      }, {
        label: 'Open-water pace',
        currentText: this.formatTrainingBuildSwimPace(current.openWaterAveragePaceSecondsPer100m),
        benchmarkText: this.formatTrainingBuildSwimPace(benchmark.openWaterAveragePaceSecondsPer100m),
        deltaText: this.formatTrainingBuildSwimPaceDelta(
          current.openWaterAveragePaceSecondsPer100m,
          benchmark.openWaterAveragePaceSecondsPer100m,
        ),
        isIntensity: false,
      });
    }
    if (current.trainingStressScore !== null || benchmark.trainingStressScore !== null) {
      rows.push({
        label: 'TSS',
        currentText: this.formatTrainingBuildNumber(current.trainingStressScore),
        benchmarkText: this.formatTrainingBuildNumber(benchmark.trainingStressScore),
        deltaText: this.formatTrainingBuildDelta(current.trainingStressScore, benchmark.trainingStressScore),
        isIntensity: false,
      });
    }
    if (discipline !== 'swimming' && (current.efficiency !== null || benchmark.efficiency !== null)) {
      rows.push({
        label: 'Power / HR',
        currentText: this.formatTrainingBuildNumber(current.efficiency, 2),
        benchmarkText: this.formatTrainingBuildNumber(benchmark.efficiency, 2),
        deltaText: this.formatTrainingBuildDelta(current.efficiency, benchmark.efficiency, 2),
        isIntensity: false,
      });
    }
    if (current.intensitySourceEventCount || benchmark.intensitySourceEventCount) {
      rows.push({
        label: 'Intensity mix',
        currentText: this.formatTrainingBuildIntensity(current),
        benchmarkText: this.formatTrainingBuildIntensity(benchmark),
        deltaText: '—',
        isIntensity: true,
      });
    }
    return rows;
  }

  private resolveEffectiveTrainingBuildSelection(discipline: DerivedTrainingDiscipline): TrainingBuildBenchmarkSelection | null {
    if (this.pendingTrainingBuildSelections.has(discipline)) {
      return this.pendingTrainingBuildSelections.get(discipline) || null;
    }
    const selection = this.trainingSettings.buildBenchmarks?.[discipline] || null;
    return getTrainingBuildBenchmarkSelectionKey(selection) ? selection : null;
  }

  private resolveCurrentUtcDayMs(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  private resolveTrainingBuildCardState(
    discipline: DerivedTrainingDiscipline,
    source: DashboardTrainingBuildComparisonDiscipline | null,
    expectedSelection: TrainingBuildBenchmarkSelection | null,
  ): TrainingBuildCardState {
    const pending = this.pendingTrainingBuildSelections.has(discipline);
    const expectedKey = getTrainingBuildBenchmarkSelectionKey(expectedSelection);
    const snapshotMatchesExpected = expectedKey
      ? source?.selection?.selectionKey === expectedKey && source.status === 'ready'
      : source?.status === 'not-configured' && this.derivedState.trainingBuildComparisonStatus === 'ready';
    if (pending && snapshotMatchesExpected) {
      this.pendingTrainingBuildSelections.delete(discipline);
    }
    if (pending && !snapshotMatchesExpected) {
      return 'updating';
    }
    if (!expectedSelection) {
      return 'not-configured';
    }
    if (this.derivedState.trainingBuildComparisonStatus === 'failed') {
      return 'unavailable';
    }
    if (
      this.derivedState.trainingBuildComparisonStatus === 'missing'
      || this.derivedState.trainingBuildComparisonStatus === 'queued'
      || this.derivedState.trainingBuildComparisonStatus === 'processing'
      || this.derivedState.trainingBuildComparisonStatus === 'building'
      || this.derivedState.trainingBuildComparisonStatus === 'stale'
      || !source
    ) {
      return 'updating';
    }
    if (source.status === 'invalid-selection') {
      return 'invalid';
    }
    return snapshotMatchesExpected ? 'ready' : 'updating';
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
        volumeCaption: 'No eligible running, cycling/MTB, or swimming sessions in the last 28 days',
        sessionsText: '0 sessions',
        sessionsCaption: 'No eligible running, cycling/MTB, or swimming sessions in the last 28 days',
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
