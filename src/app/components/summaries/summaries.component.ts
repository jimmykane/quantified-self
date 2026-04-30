import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DoCheck,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { firstValueFrom, Subscription, take } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { CdkDragDrop, CdkDragSortEvent, moveItemInArray } from '@angular/cdk/drag-drop';
import { AppThemeService } from '../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../services/logger.service';
import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  DateRanges,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import equal from 'fast-deep-equal';
import type { EventStatAggregationPreferences } from '@shared/event-stat-aggregation.types';
import {
  buildDashboardTileViewModels,
  type DashboardChartTileViewModel,
  type DashboardMapTileViewModel,
  type DashboardTileViewModel,
  isDashboardChartTileViewModel,
} from '../../helpers/dashboard-tile-view-model.helper';
import { AppUserService } from '../../services/app.user.service';
import { DashboardDerivedMetricsService } from '../../services/dashboard-derived-metrics.service';
import { AppSleepService } from '../../services/app.sleep.service';
import type { DashboardFormPoint } from '../../helpers/dashboard-form.helper';
import type { DashboardRecoveryNowContext } from '../../helpers/dashboard-recovery-now.helper';
import type {
  DashboardAcwrContext,
  DashboardEasyPercentContext,
  DashboardEfficiencyDelta4wContext,
  DashboardEfficiencyTrendContext,
  DashboardFreshnessForecastContext,
  DashboardFormNowContext,
  DashboardFormPlus7dContext,
  DashboardHardPercentContext,
  DashboardIntensityDistributionContext,
  DashboardMonotonyStrainContext,
  DashboardRampRateContext,
} from '../../helpers/dashboard-derived-metrics.helper';
import {
  type DashboardDerivedMetricStatus,
  isDerivedMetricPendingStatus,
} from '../../helpers/derived-metric-status.helper';
import {
  isDashboardAcwrKpiChartType,
  isDashboardEasyPercentKpiChartType,
  isDashboardEfficiencyDelta4wKpiChartType,
  isDashboardEfficiencyTrendChartType,
  isDashboardFreshnessForecastChartType,
  isDashboardFormChartType,
  isDashboardFormNowKpiChartType,
  isDashboardFormPlus7dKpiChartType,
  isDashboardHardPercentKpiChartType,
  isDashboardIntensityDistributionChartType,
  isDashboardKpiChartType,
  isDashboardMonotonyStrainKpiChartType,
  isDashboardRampRateKpiChartType,
  isDashboardRecoveryNowChartType,
} from '../../helpers/dashboard-special-chart-types';
import { MatDialog } from '@angular/material/dialog';
import { DashboardManagerDialogComponent } from './dashboard-manager-dialog/dashboard-manager-dialog.component';
import type { SleepSession } from '@shared/sleep';
import type {
  AppDashboardSettingsInterface,
  AppDashboardSleepTrendRange,
  AppUserInterface,
} from '../../models/app-user.interface';
import {
  dashboardSleepTrendRangeDays,
  type DashboardSleepTrendNavigationDirection,
  DASHBOARD_SLEEP_TREND_DEFAULT_RANGE,
  normalizeDashboardSleepTrendRange,
} from '../../helpers/dashboard-sleep-range.helper';

interface DashboardDerivedMetricsBanner {
  type: 'pending' | 'warning';
  title: string;
  description: string;
  showRetry: boolean;
}

@Component({
  selector: 'app-summaries',
  templateUrl: './summaries.component.html',
  styleUrls: ['./summaries.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class SummariesComponent extends LoadingAbstractDirective implements OnInit, OnDestroy, OnChanges, DoCheck {
  private static readonly desktopMinWidthMediaQuery = '(min-width: 960px)';
  private static readonly finePointerMediaQuery = '(pointer: fine)';
  private static readonly hoverMediaQuery = '(hover: hover)';
  private static readonly derivedPendingBannerDebounceMs = 250;

  @Input() events: EventInterface[];
  @Input() user: User;
  @Input() showActions: boolean;
  @Input() dashboardDateRange: DateRanges | null = null;
  @Input() dashboardStartDate: Date | number | null = null;
  @Input() dashboardEndDate: Date | number | null = null;

  public rowHeight;
  public numberOfCols: number;


  public tiles: DashboardTileViewModel[] = [];
  public kpiLaneTiles: DashboardChartTileViewModel[] = [];
  public mainGridTiles: DashboardTileViewModel[] = [];

  public tileTypes = TileTypes;
  public desktopTileDragEnabled = false;
  public isDashboardManagerOpen = false;
  public sleepTrendRange: AppDashboardSleepTrendRange = DASHBOARD_SLEEP_TREND_DEFAULT_RANGE;
  public sleepTrendWindowLabel = 'Last 14 days';
  public sleepTrendCanNavigateOlder = true;
  public sleepTrendCanNavigateNewer = false;


  private appThemeSubscription: Subscription | null = null;
  private derivedMetricsSubscription: Subscription | null = null;
  private derivedMetricsUserUID: string | null = null;
  private sleepSubscription: Subscription | null = null;
  private sleepListenerKey: string | null = null;
  private sleepTrendAnchorEndMs: number | null = null;
  public darkTheme = false;
  private logger: LoggerService;
  private dashboardTileSettingsSnapshot: TileSettingsInterface[] = [];
  private sleepSessions: SleepSession[] = [];
  private derivedFormPoints: DashboardFormPoint[] | null = null;
  private derivedRecoveryNowContext: DashboardRecoveryNowContext | null = null;
  private derivedAcwrContext: DashboardAcwrContext | null = null;
  private derivedRampRateContext: DashboardRampRateContext | null = null;
  private derivedMonotonyStrainContext: DashboardMonotonyStrainContext | null = null;
  private derivedFormNowContext: DashboardFormNowContext | null = null;
  private derivedFormPlus7dContext: DashboardFormPlus7dContext | null = null;
  private derivedEasyPercentContext: DashboardEasyPercentContext | null = null;
  private derivedHardPercentContext: DashboardHardPercentContext | null = null;
  private derivedEfficiencyDelta4wContext: DashboardEfficiencyDelta4wContext | null = null;
  private derivedFreshnessForecastContext: DashboardFreshnessForecastContext | null = null;
  private derivedIntensityDistributionContext: DashboardIntensityDistributionContext | null = null;
  private derivedEfficiencyTrendContext: DashboardEfficiencyTrendContext | null = null;
  private derivedFormStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedRecoveryNowStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedAcwrStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedRampRateStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedMonotonyStrainStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedFormNowStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedFormPlus7dStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedEasyPercentStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedHardPercentStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedEfficiencyDelta4wStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedFreshnessForecastStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedIntensityDistributionStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedEfficiencyTrendStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedMetricsHydrated = false;
  private derivedPendingBannerTimeout: ReturnType<typeof setTimeout> | null = null;
  public derivedMetricsBanner: DashboardDerivedMetricsBanner | null = null;

  constructor(
    private themeService: AppThemeService,
    private userService: AppUserService,
    private dashboardDerivedMetricsService: DashboardDerivedMetricsService,
    private sleepService: AppSleepService,
    private dialog: MatDialog,
    changeDetector: ChangeDetectorRef,
    logger: LoggerService,
  ) {
    super(changeDetector);
    this.logger = logger;
    this.rowHeight = this.getRowHeight();
    this.numberOfCols = this.getNumberOfColumns();
  }

  @HostListener('window:resize', ['$event'])
  @HostListener('window:orientationchange', ['$event'])
  resizeOROrientationChange(event?) {
    this.numberOfCols = this.getNumberOfColumns();
    this.rowHeight = this.getRowHeight();
    this.updateDesktopTileDragCapability();
  }

  ngOnInit() {
    this.updateDesktopTileDragCapability();
  }

  async ngOnChanges(simpleChanges: SimpleChanges) {
    this.updateDesktopTileDragCapability();
    if (
      simpleChanges.events
      || simpleChanges.user
      || simpleChanges.dashboardDateRange
      || simpleChanges.dashboardStartDate
      || simpleChanges.dashboardEndDate
    ) {
      return this.unsubscribeAndCreateCharts();
    }
  }

  ngDoCheck(): void {
    const nextTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
    if (equal(this.dashboardTileSettingsSnapshot, nextTileSettingsSnapshot)) {
      return;
    }

    this.dashboardTileSettingsSnapshot = nextTileSettingsSnapshot;
    void this.unsubscribeAndCreateCharts();
  }

  ngOnDestroy(): void {
    this.clearDerivedPendingBannerTimeout();
    this.unsubscribeFromAll();
  }

  public trackByTile(index: number, item: DashboardTileViewModel) {
    if (!item) {
      return null;
    }
    if (isDashboardChartTileViewModel(item)) {
      return `${item.chartType}${item.dataCategoryType}${item.dataValueType}${item.name}${item.order}${item.timeInterval}`;
    }
    const mapItem = item as DashboardMapTileViewModel;
    return `${mapItem.clusterMarkers}${mapItem.mapTheme}${mapItem.mapStyle}${mapItem.name}${mapItem.order}${mapItem.showHeatMap}`;
  }

  public async onTilesDrop(_event: CdkDragDrop<DashboardTileViewModel[]>): Promise<void> {
    this.ensureTileLanesInitializedFromTiles();
    await this.persistLaneOrder();
  }

  public async onKpiTilesDrop(_event: CdkDragDrop<DashboardChartTileViewModel[]>): Promise<void> {
    this.ensureTileLanesInitializedFromTiles();
    await this.persistLaneOrder();
  }

  public onTilesSort(event: CdkDragSortEvent<DashboardTileViewModel[]>): void {
    this.ensureTileLanesInitializedFromTiles();
    if (!this.desktopTileDragEnabled || !this.showActions || this.mainGridTiles.length < 2 || event.previousIndex === event.currentIndex) {
      return;
    }
    moveItemInArray(this.mainGridTiles, event.previousIndex, event.currentIndex);
    this.syncTilesFromLanesForPreview();
    this.changeDetector.detectChanges();
  }

  public onKpiTilesSort(event: CdkDragSortEvent<DashboardChartTileViewModel[]>): void {
    this.ensureTileLanesInitializedFromTiles();
    if (!this.desktopTileDragEnabled || !this.showActions || this.kpiLaneTiles.length < 2 || event.previousIndex === event.currentIndex) {
      return;
    }
    moveItemInArray(this.kpiLaneTiles, event.previousIndex, event.currentIndex);
    this.syncTilesFromLanesForPreview();
    this.changeDetector.detectChanges();
  }

  public async openDashboardManagerDialog(): Promise<void> {
    return this.openDashboardManagerDialogWithState();
  }

  public async openDashboardManagerForTileOrder(order: number): Promise<void> {
    await this.openDashboardManagerDialogWithState({
      initialMode: 'edit',
      initialEditTileOrder: Number(order),
    });
  }

  private async openDashboardManagerDialogWithState(
    initialState?: { initialMode?: 'add' | 'edit'; initialEditTileOrder?: number | null },
  ): Promise<void> {
    if (!this.showActions || !this.user || this.isDashboardManagerOpen) {
      return;
    }

    this.isDashboardManagerOpen = true;
    this.changeDetector.markForCheck();

    try {
      const dialogRef = this.dialog.open(DashboardManagerDialogComponent, {
        data: {
          user: this.user,
          initialMode: initialState?.initialMode,
          initialEditTileOrder: initialState?.initialEditTileOrder ?? null,
        },
        width: '680px',
        maxWidth: '95vw',
      });
      const result = await firstValueFrom(dialogRef.afterClosed().pipe(take(1)));
      if (result?.saved === true) {
        await this.rebuildTilesFromCurrentState();
      }
    } finally {
      this.isDashboardManagerOpen = false;
      this.changeDetector.markForCheck();
    }
  }

  private async unsubscribeAndCreateCharts() {
    this.unsubscribeThemeSubscription();
    this.appThemeSubscription = this.themeService.getAppTheme().subscribe((theme) => {
      const nextDarkTheme = theme === AppThemes.Dark;
      if (this.darkTheme === nextDarkTheme) {
        return;
      }
      this.darkTheme = nextDarkTheme;
      // OnPush component: explicit mark ensures chart inputs update immediately
      // when theme toggles so ECharts axis/label colors switch correctly.
      this.changeDetector.markForCheck();
    });
    this.syncDerivedMetricsSubscription();
    this.syncSleepSubscription();
    await this.rebuildTilesFromCurrentState();
  }

  private async rebuildTilesFromCurrentState(): Promise<void> {
    const buildStart = performance.now();
    this.logRecoveryPipelineState('before_tile_build');
    this.refreshDerivedMetricsBannerState();
    const newTiles = buildDashboardTileViewModels({
      tiles: this.user?.settings?.dashboardSettings?.tiles ?? [],
      events: this.events,
      sleepSessions: this.sleepSessions,
      dashboardDateRange: {
        dateRange: this.dashboardDateRange,
        startDate: this.dashboardStartDate,
        endDate: this.dashboardEndDate,
        startOfTheWeek: this.user?.settings?.unitSettings?.startOfTheWeek,
      },
      preferences: this.getAggregationPreferences(),
      logger: this.logger,
      derivedMetrics: {
        formPoints: this.derivedFormPoints,
        recoveryNow: this.derivedRecoveryNowContext,
        acwr: this.derivedAcwrContext,
        rampRate: this.derivedRampRateContext,
        monotonyStrain: this.derivedMonotonyStrainContext,
        formNow: this.derivedFormNowContext,
        formPlus7d: this.derivedFormPlus7dContext,
        easyPercent: this.derivedEasyPercentContext,
        hardPercent: this.derivedHardPercentContext,
        efficiencyDelta4w: this.derivedEfficiencyDelta4wContext,
        freshnessForecast: this.derivedFreshnessForecastContext,
        intensityDistribution: this.derivedIntensityDistributionContext,
        efficiencyTrend: this.derivedEfficiencyTrendContext,
      },
    });
    this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
    this.logger.log('[perf] summaries_build_tiles', {
      durationMs: Number((performance.now() - buildStart).toFixed(2)),
      inputEvents: this.events?.length || 0,
      generatedTiles: newTiles.length,
    });

    if (!this.tiles.length && newTiles.length) {
      this.tiles = newTiles;
      this.refreshTileLanes();
      this.updateDesktopTileDragCapability();
      this.loaded();
      this.logger.log('[perf] summaries_commit_tiles', {
        durationMs: Number((performance.now() - buildStart).toFixed(2)),
        finalTiles: this.tiles.length,
      });
      return;
    }

    newTiles.forEach(newChart => {
      const sameOrderChart = this.tiles.find(chart => chart.order === newChart.order);
      if (!sameOrderChart) {
        this.tiles.push(newChart);
        return;
      }
      if (!equal(sameOrderChart, newChart)) {
        this.tiles[this.tiles.findIndex(chart => chart === sameOrderChart)] = newChart;
      }
    });
    this.tiles = this.tiles.filter(chart => newTiles.find(newChart => newChart.order === chart.order));
    this.refreshTileLanes();
    this.updateDesktopTileDragCapability();
    this.loaded();
    this.logger.log('[perf] summaries_commit_tiles', {
      durationMs: Number((performance.now() - buildStart).toFixed(2)),
      finalTiles: this.tiles.length,
    });
    this.logRecoveryPipelineState('after_tile_build');
  }

  private syncDerivedMetricsSubscription(): void {
    const uid = `${this.user?.uid || ''}`.trim();
    if (!uid) {
      this.derivedMetricsUserUID = null;
      this.resetDerivedMetricsState();
      if (this.derivedMetricsSubscription) {
        this.derivedMetricsSubscription.unsubscribe();
        this.derivedMetricsSubscription = null;
      }
      return;
    }

    if (this.derivedMetricsUserUID === uid && this.derivedMetricsSubscription) {
      return;
    }

    if (this.derivedMetricsSubscription) {
      this.derivedMetricsSubscription.unsubscribe();
      this.derivedMetricsSubscription = null;
    }

    this.derivedMetricsUserUID = uid;
    this.resetDerivedMetricsState();

    this.derivedMetricsSubscription = this.dashboardDerivedMetricsService.watch(this.user).subscribe((state) => {
      this.dashboardDerivedMetricsService.ensureForDashboard(this.user, state);
      const wasHydrated = this.derivedMetricsHydrated;
      if (!wasHydrated) {
        this.derivedMetricsHydrated = true;
      }

      const hasFormPointsChanged = !equal(this.derivedFormPoints, state.formPoints);
      const hasRecoveryContextChanged = !equal(this.derivedRecoveryNowContext, state.recoveryNow);
      const hasAcwrChanged = !equal(this.derivedAcwrContext, state.acwr);
      const hasRampRateChanged = !equal(this.derivedRampRateContext, state.rampRate);
      const hasMonotonyStrainChanged = !equal(this.derivedMonotonyStrainContext, state.monotonyStrain);
      const hasFormNowChanged = !equal(this.derivedFormNowContext, state.formNow);
      const hasFormPlus7dChanged = !equal(this.derivedFormPlus7dContext, state.formPlus7d);
      const hasEasyPercentChanged = !equal(this.derivedEasyPercentContext, state.easyPercent);
      const hasHardPercentChanged = !equal(this.derivedHardPercentContext, state.hardPercent);
      const hasEfficiencyDelta4wChanged = !equal(this.derivedEfficiencyDelta4wContext, state.efficiencyDelta4w);
      const hasFreshnessForecastChanged = !equal(this.derivedFreshnessForecastContext, state.freshnessForecast);
      const hasIntensityDistributionChanged = !equal(this.derivedIntensityDistributionContext, state.intensityDistribution);
      const hasEfficiencyTrendChanged = !equal(this.derivedEfficiencyTrendContext, state.efficiencyTrend);
      const hasFormStatusChanged = this.derivedFormStatus !== state.formStatus;
      const hasRecoveryStatusChanged = this.derivedRecoveryNowStatus !== state.recoveryNowStatus;
      const hasAcwrStatusChanged = this.derivedAcwrStatus !== state.acwrStatus;
      const hasRampRateStatusChanged = this.derivedRampRateStatus !== state.rampRateStatus;
      const hasMonotonyStrainStatusChanged = this.derivedMonotonyStrainStatus !== state.monotonyStrainStatus;
      const hasFormNowStatusChanged = this.derivedFormNowStatus !== state.formNowStatus;
      const hasFormPlus7dStatusChanged = this.derivedFormPlus7dStatus !== state.formPlus7dStatus;
      const hasEasyPercentStatusChanged = this.derivedEasyPercentStatus !== state.easyPercentStatus;
      const hasHardPercentStatusChanged = this.derivedHardPercentStatus !== state.hardPercentStatus;
      const hasEfficiencyDelta4wStatusChanged = this.derivedEfficiencyDelta4wStatus !== state.efficiencyDelta4wStatus;
      const hasFreshnessForecastStatusChanged = this.derivedFreshnessForecastStatus !== state.freshnessForecastStatus;
      const hasIntensityDistributionStatusChanged = this.derivedIntensityDistributionStatus !== state.intensityDistributionStatus;
      const hasEfficiencyTrendStatusChanged = this.derivedEfficiencyTrendStatus !== state.efficiencyTrendStatus;
      const hasBannerStateChanged = hasFormStatusChanged
        || hasRecoveryStatusChanged
        || hasAcwrStatusChanged
        || hasRampRateStatusChanged
        || hasMonotonyStrainStatusChanged
        || hasFormNowStatusChanged
        || hasFormPlus7dStatusChanged
        || hasEasyPercentStatusChanged
        || hasHardPercentStatusChanged
        || hasEfficiencyDelta4wStatusChanged
        || hasFreshnessForecastStatusChanged
        || hasIntensityDistributionStatusChanged
        || hasEfficiencyTrendStatusChanged;
      const hasTileDataChanged = hasFormPointsChanged
        || hasRecoveryContextChanged
        || hasAcwrChanged
        || hasRampRateChanged
        || hasMonotonyStrainChanged
        || hasFormNowChanged
        || hasFormPlus7dChanged
        || hasEasyPercentChanged
        || hasHardPercentChanged
        || hasEfficiencyDelta4wChanged
        || hasFreshnessForecastChanged
        || hasIntensityDistributionChanged
        || hasEfficiencyTrendChanged;
      if (!hasTileDataChanged && !hasBannerStateChanged && wasHydrated) {
        return;
      }

      if (!hasTileDataChanged && !hasBannerStateChanged && !wasHydrated) {
        this.refreshDerivedMetricsBannerState();
        this.changeDetector.markForCheck();
        return;
      }

      this.derivedFormPoints = state.formPoints;
      this.derivedRecoveryNowContext = state.recoveryNow;
      this.derivedAcwrContext = state.acwr;
      this.derivedRampRateContext = state.rampRate;
      this.derivedMonotonyStrainContext = state.monotonyStrain;
      this.derivedFormNowContext = state.formNow;
      this.derivedFormPlus7dContext = state.formPlus7d;
      this.derivedEasyPercentContext = state.easyPercent;
      this.derivedHardPercentContext = state.hardPercent;
      this.derivedEfficiencyDelta4wContext = state.efficiencyDelta4w;
      this.derivedFreshnessForecastContext = state.freshnessForecast;
      this.derivedIntensityDistributionContext = state.intensityDistribution;
      this.derivedEfficiencyTrendContext = state.efficiencyTrend;
      this.derivedFormStatus = state.formStatus;
      this.derivedRecoveryNowStatus = state.recoveryNowStatus;
      this.derivedAcwrStatus = state.acwrStatus;
      this.derivedRampRateStatus = state.rampRateStatus;
      this.derivedMonotonyStrainStatus = state.monotonyStrainStatus;
      this.derivedFormNowStatus = state.formNowStatus;
      this.derivedFormPlus7dStatus = state.formPlus7dStatus;
      this.derivedEasyPercentStatus = state.easyPercentStatus;
      this.derivedHardPercentStatus = state.hardPercentStatus;
      this.derivedEfficiencyDelta4wStatus = state.efficiencyDelta4wStatus;
      this.derivedFreshnessForecastStatus = state.freshnessForecastStatus;
      this.derivedIntensityDistributionStatus = state.intensityDistributionStatus;
      this.derivedEfficiencyTrendStatus = state.efficiencyTrendStatus;
      this.logRecoveryPipelineState('derived_metrics_update');
      this.refreshDerivedMetricsBannerState();

      if (hasTileDataChanged) {
        void this.rebuildTilesFromCurrentState();
        return;
      }

      this.changeDetector.markForCheck();
    });
  }

  private unsubscribeThemeSubscription(): void {
    if (this.appThemeSubscription) {
      this.appThemeSubscription.unsubscribe();
      this.appThemeSubscription = null;
    }
  }

  private syncSleepSubscription(): void {
    const uid = `${this.user?.uid || ''}`.trim();
    if (!uid) {
      this.sleepSessions = [];
      this.sleepListenerKey = null;
      this.sleepTrendRange = DASHBOARD_SLEEP_TREND_DEFAULT_RANGE;
      this.sleepTrendAnchorEndMs = null;
      this.updateSleepTrendWindowState(this.buildSleepTrendWindow());
      if (this.sleepSubscription) {
        this.sleepSubscription.unsubscribe();
        this.sleepSubscription = null;
      }
      return;
    }

    const previousRange = this.sleepTrendRange;
    this.sleepTrendRange = this.getSleepTrendRange();
    if (previousRange !== this.sleepTrendRange) {
      this.sleepTrendAnchorEndMs = null;
    }

    const window = this.buildSleepTrendWindow();
    this.updateSleepTrendWindowState(window);
    const listenerKey = this.buildSleepListenerKey(uid, window);
    if (this.sleepListenerKey === listenerKey && this.sleepSubscription) {
      return;
    }

    if (this.sleepSubscription) {
      this.sleepSubscription.unsubscribe();
      this.sleepSubscription = null;
    }

    this.sleepListenerKey = listenerKey;
    this.sleepSubscription = this.sleepService
      .watchForDashboard(uid, window.startMs, window.endMs)
      .subscribe((sessions) => {
        if (equal(this.sleepSessions, sessions)) {
          return;
        }
        this.sleepSessions = sessions;
        void this.rebuildTilesFromCurrentState();
      });
  }

  public async onSleepTrendRangeChange(range: AppDashboardSleepTrendRange): Promise<void> {
    const nextRange = normalizeDashboardSleepTrendRange(range);
    if (nextRange === this.getSleepTrendRange()) {
      return;
    }
    if (!this.user) {
      return;
    }

    const userWithSettings = this.user as AppUserInterface;
    userWithSettings.settings = userWithSettings.settings || {};
    const dashboardSettings = (userWithSettings.settings.dashboardSettings || {}) as AppDashboardSettingsInterface;
    userWithSettings.settings.dashboardSettings = dashboardSettings;
    const previousSleepTrend = { ...(dashboardSettings.sleepTrend || {}) };

    dashboardSettings.sleepTrend = {
      ...previousSleepTrend,
      range: nextRange,
    };
    this.sleepTrendRange = nextRange;
    this.sleepTrendAnchorEndMs = null;
    this.syncSleepSubscription();
    this.changeDetector.markForCheck();

    try {
      await this.userService.updateUserProperties(this.user as AppUserInterface, { settings: userWithSettings.settings });
    } catch (error) {
      dashboardSettings.sleepTrend = previousSleepTrend;
      this.sleepTrendRange = normalizeDashboardSleepTrendRange(previousSleepTrend.range);
      this.sleepTrendAnchorEndMs = null;
      this.syncSleepSubscription();
      this.changeDetector.markForCheck();
      this.logger.error('[SummariesComponent] Failed to persist sleep trend range update', error);
    }
  }

  public onSleepTrendNavigate(direction: DashboardSleepTrendNavigationDirection): void {
    const days = dashboardSleepTrendRangeDays(this.sleepTrendRange);
    if (days === null) {
      return;
    }

    const nowMs = Date.now();
    const windowMs = days * 24 * 60 * 60 * 1000;
    const currentWindow = this.buildSleepTrendWindow(nowMs);
    if (direction === 'older') {
      this.sleepTrendAnchorEndMs = Math.max(windowMs, currentWindow.endMs - windowMs);
    } else {
      const nextEndMs = currentWindow.endMs + windowMs;
      this.sleepTrendAnchorEndMs = nextEndMs >= nowMs ? null : nextEndMs;
    }

    this.syncSleepSubscription();
    this.changeDetector.markForCheck();
  }

  private buildSleepListenerKey(uid: string, window: { range: AppDashboardSleepTrendRange; startMs: number; endMs: number; isAll: boolean }): string {
    if (window.isAll) {
      return `${uid}:${window.range}:all`;
    }
    const anchorKey = this.sleepTrendAnchorEndMs === null ? 'latest' : `${window.startMs}:${window.endMs}`;
    return `${uid}:${window.range}:${anchorKey}`;
  }

  private getSleepTrendRange(): AppDashboardSleepTrendRange {
    return normalizeDashboardSleepTrendRange((this.user as AppUserInterface)?.settings?.dashboardSettings?.sleepTrend?.range);
  }

  private buildSleepTrendWindow(nowMs = Date.now()): {
    range: AppDashboardSleepTrendRange;
    startMs: number;
    endMs: number;
    isAll: boolean;
  } {
    const range = this.sleepTrendRange || this.getSleepTrendRange();
    const days = dashboardSleepTrendRangeDays(range);
    if (days === null) {
      return {
        range,
        startMs: 0,
        endMs: nowMs,
        isAll: true,
      };
    }

    const windowMs = days * 24 * 60 * 60 * 1000;
    const anchorEndMs = Number.isFinite(this.sleepTrendAnchorEndMs) && this.sleepTrendAnchorEndMs !== null
      ? Math.min(this.sleepTrendAnchorEndMs, nowMs)
      : nowMs;
    return {
      range,
      startMs: Math.max(0, anchorEndMs - windowMs),
      endMs: anchorEndMs,
      isAll: false,
    };
  }

  private updateSleepTrendWindowState(window: { range: AppDashboardSleepTrendRange; startMs: number; endMs: number; isAll: boolean }): void {
    this.sleepTrendRange = window.range;
    this.sleepTrendCanNavigateOlder = !window.isAll;
    this.sleepTrendCanNavigateNewer = !window.isAll && this.sleepTrendAnchorEndMs !== null;
    this.sleepTrendWindowLabel = this.formatSleepTrendWindowLabel(window);
  }

  private formatSleepTrendWindowLabel(window: { range: AppDashboardSleepTrendRange; startMs: number; endMs: number; isAll: boolean }): string {
    if (window.isAll) {
      return 'All sleep';
    }
    const days = dashboardSleepTrendRangeDays(window.range) || 14;
    if (this.sleepTrendAnchorEndMs === null) {
      return `Last ${days} days`;
    }
    return `${this.formatSleepTrendWindowDate(window.startMs)} - ${this.formatSleepTrendWindowDate(window.endMs)}`;
  }

  private formatSleepTrendWindowDate(timestampMs: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(new Date(timestampMs));
  }

  private resetDerivedMetricsState(): void {
    this.derivedMetricsHydrated = false;
    this.clearDerivedPendingBannerTimeout();
    this.derivedFormPoints = null;
    this.derivedRecoveryNowContext = null;
    this.derivedAcwrContext = null;
    this.derivedRampRateContext = null;
    this.derivedMonotonyStrainContext = null;
    this.derivedFormNowContext = null;
    this.derivedFormPlus7dContext = null;
    this.derivedEasyPercentContext = null;
    this.derivedHardPercentContext = null;
    this.derivedEfficiencyDelta4wContext = null;
    this.derivedFreshnessForecastContext = null;
    this.derivedIntensityDistributionContext = null;
    this.derivedEfficiencyTrendContext = null;
    this.derivedFormStatus = 'missing';
    this.derivedRecoveryNowStatus = 'missing';
    this.derivedAcwrStatus = 'missing';
    this.derivedRampRateStatus = 'missing';
    this.derivedMonotonyStrainStatus = 'missing';
    this.derivedFormNowStatus = 'missing';
    this.derivedFormPlus7dStatus = 'missing';
    this.derivedEasyPercentStatus = 'missing';
    this.derivedHardPercentStatus = 'missing';
    this.derivedEfficiencyDelta4wStatus = 'missing';
    this.derivedFreshnessForecastStatus = 'missing';
    this.derivedIntensityDistributionStatus = 'missing';
    this.derivedEfficiencyTrendStatus = 'missing';
    this.refreshDerivedMetricsBannerState();
  }

  private getDashboardTileSettingsSnapshot(): TileSettingsInterface[] {
    return (this.user?.settings?.dashboardSettings?.tiles ?? []).map((tile: TileSettingsInterface) => {
      const snapshot: TileSettingsInterface = {
        ...tile,
        size: tile.size ? { ...tile.size } : tile.size
      };

      if (tile.type !== TileTypes.Chart) {
        return snapshot;
      }

      return {
        ...snapshot,
        dataTimeInterval: (tile as TileChartSettingsInterface).dataTimeInterval || TimeIntervals.Auto
      } as TileChartSettingsInterface;
    });
  }

  private getOrderedDashboardSettingsTiles(): TileSettingsInterface[] {
    return [...(this.user?.settings?.dashboardSettings?.tiles ?? [])]
      .sort((left, right) => left.order - right.order);
  }

  private updateDesktopTileDragCapability(): void {
    this.ensureTileLanesInitializedFromTiles();
    const hasDraggableLane = this.mainGridTiles.length > 1 || this.kpiLaneTiles.length > 1;
    this.desktopTileDragEnabled = this.showActions === true
      && hasDraggableLane
      && this.matchesMediaQuery(SummariesComponent.desktopMinWidthMediaQuery)
      && this.matchesMediaQuery(SummariesComponent.finePointerMediaQuery)
      && this.matchesMediaQuery(SummariesComponent.hoverMediaQuery);
  }

  private matchesMediaQuery(query: string): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  }

  private cloneTileSettings(tiles: TileSettingsInterface[]): TileSettingsInterface[] {
    return tiles.map((tile: TileSettingsInterface) => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size
    }));
  }

  private cloneDashboardViewModels(tiles: DashboardTileViewModel[]): DashboardTileViewModel[] {
    return tiles.map((tile: DashboardTileViewModel) => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size
    })) as DashboardTileViewModel[];
  }

  private withSequentialOrder<T extends { order: number }>(tiles: T[]): T[] {
    return tiles.map((tile, index) => ({ ...tile, order: index })) as T[];
  }

  private isKpiLaneTile(tile: DashboardTileViewModel): tile is DashboardChartTileViewModel {
    if (!isDashboardChartTileViewModel(tile)) {
      return false;
    }
    return isDashboardKpiChartType(tile.chartType);
  }

  private isKpiSettingsTile(tile: TileSettingsInterface): tile is TileChartSettingsInterface {
    if (tile.type !== TileTypes.Chart) {
      return false;
    }
    return isDashboardKpiChartType((tile as TileChartSettingsInterface).chartType);
  }

  private refreshTileLanes(): void {
    const orderedTiles = [...this.tiles].sort((left, right) => left.order - right.order);
    this.kpiLaneTiles = orderedTiles.filter((tile): tile is DashboardChartTileViewModel => this.isKpiLaneTile(tile));
    this.mainGridTiles = orderedTiles.filter(tile => !this.isKpiLaneTile(tile));
  }

  private ensureTileLanesInitializedFromTiles(): void {
    if ((this.kpiLaneTiles.length + this.mainGridTiles.length) !== this.tiles.length) {
      this.refreshTileLanes();
    }
  }

  private syncTilesFromLanesForPreview(): void {
    this.tiles = [...this.kpiLaneTiles, ...this.mainGridTiles];
  }

  private async persistLaneOrder(): Promise<void> {
    if (!this.desktopTileDragEnabled) {
      return;
    }

    const dashboardSettings = this.user?.settings?.dashboardSettings;
    if (!dashboardSettings?.tiles?.length || !this.showActions || this.tiles.length < 2) {
      return;
    }

    const orderedSettingsTiles = this.getOrderedDashboardSettingsTiles();
    if (!orderedSettingsTiles.length) {
      return;
    }
    const currentViewOrder = [...this.kpiLaneTiles, ...this.mainGridTiles].map(tile => tile.order);
    const currentSettingsOrder = [
      ...orderedSettingsTiles.filter(tile => this.isKpiSettingsTile(tile)).map(tile => tile.order),
      ...orderedSettingsTiles.filter(tile => !this.isKpiSettingsTile(tile)).map(tile => tile.order),
    ];
    if (this.getOrderSignature(currentViewOrder) === this.getOrderSignature(currentSettingsOrder)) {
      return;
    }

    const settingsByOrder = new Map<number, TileSettingsInterface>(
      orderedSettingsTiles.map(tile => [tile.order, tile])
    );
    const nextKpiSettingsTiles = this.kpiLaneTiles
      .map(tile => settingsByOrder.get(tile.order))
      .filter((tile): tile is TileSettingsInterface => !!tile);
    const nextMainGridSettingsTiles = this.mainGridTiles
      .map(tile => settingsByOrder.get(tile.order))
      .filter((tile): tile is TileSettingsInterface => !!tile);
    const nextSettingsTiles = [...nextKpiSettingsTiles, ...nextMainGridSettingsTiles];

    if (nextSettingsTiles.length !== orderedSettingsTiles.length) {
      this.logger.warn('[SummariesComponent] Skipping dashboard tile drag persist because order mapping was incomplete.');
      return;
    }

    const previousSettingsTiles = this.cloneTileSettings(dashboardSettings.tiles);
    const previousRenderedTiles = this.cloneDashboardViewModels(this.tiles);
    const previousRenderedTilesByPersistedOrder = [...previousRenderedTiles]
      .sort((left, right) => left.order - right.order);
    dashboardSettings.tiles = this.withSequentialOrder(nextSettingsTiles);
    this.tiles = this.withSequentialOrder(this.cloneDashboardViewModels([...this.kpiLaneTiles, ...this.mainGridTiles]));
    this.refreshTileLanes();
    this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();

    try {
      await this.userService.updateUserProperties(this.user as any, { settings: this.user?.settings });
      this.updateDesktopTileDragCapability();
    } catch (error) {
      dashboardSettings.tiles = this.cloneTileSettings(previousSettingsTiles);
      this.tiles = this.withSequentialOrder(this.cloneDashboardViewModels(previousRenderedTilesByPersistedOrder));
      this.refreshTileLanes();
      this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
      this.updateDesktopTileDragCapability();
      this.logger.error('[SummariesComponent] Failed to persist dashboard tile drag order update', error);
    }
  }

  private getOrderSignature(orders: number[]): string {
    return orders.join(',');
  }

  private unsubscribeFromAll() {
    this.unsubscribeThemeSubscription();
    this.clearDerivedPendingBannerTimeout();
    if (this.derivedMetricsSubscription) {
      this.derivedMetricsSubscription.unsubscribe();
      this.derivedMetricsSubscription = null;
      this.derivedMetricsUserUID = null;
    }
    if (this.sleepSubscription) {
      this.sleepSubscription.unsubscribe();
      this.sleepSubscription = null;
      this.sleepListenerKey = null;
    }
  }

  public retryDerivedMetricsRebuild(): void {
    if (!this.user) {
      return;
    }

    this.dashboardDerivedMetricsService.ensureForDashboard(this.user, {
      formPoints: this.derivedFormPoints,
      recoveryNow: this.derivedRecoveryNowContext,
      acwr: this.derivedAcwrContext,
      rampRate: this.derivedRampRateContext,
      monotonyStrain: this.derivedMonotonyStrainContext,
      formNow: this.derivedFormNowContext,
      formPlus7d: this.derivedFormPlus7dContext,
      easyPercent: this.derivedEasyPercentContext,
      hardPercent: this.derivedHardPercentContext,
      efficiencyDelta4w: this.derivedEfficiencyDelta4wContext,
      freshnessForecast: this.derivedFreshnessForecastContext,
      intensityDistribution: this.derivedIntensityDistributionContext,
      efficiencyTrend: this.derivedEfficiencyTrendContext,
      formStatus: this.derivedFormStatus,
      recoveryNowStatus: this.derivedRecoveryNowStatus,
      acwrStatus: this.derivedAcwrStatus,
      rampRateStatus: this.derivedRampRateStatus,
      monotonyStrainStatus: this.derivedMonotonyStrainStatus,
      formNowStatus: this.derivedFormNowStatus,
      formPlus7dStatus: this.derivedFormPlus7dStatus,
      easyPercentStatus: this.derivedEasyPercentStatus,
      hardPercentStatus: this.derivedHardPercentStatus,
      efficiencyDelta4wStatus: this.derivedEfficiencyDelta4wStatus,
      freshnessForecastStatus: this.derivedFreshnessForecastStatus,
      intensityDistributionStatus: this.derivedIntensityDistributionStatus,
      efficiencyTrendStatus: this.derivedEfficiencyTrendStatus,
    }, { force: true });
  }

  private refreshDerivedMetricsBannerState(): void {
    const dashboardTiles = this.user?.settings?.dashboardSettings?.tiles ?? [];
    const relevantStatuses = dashboardTiles
      .map((tile) => {
        if (tile.type !== TileTypes.Chart) {
          return null;
        }
        return this.resolveDerivedStatusForChartType((tile as TileChartSettingsInterface).chartType);
      })
      .filter((status): status is DashboardDerivedMetricStatus => !!status);

    if (!relevantStatuses.length) {
      this.clearDerivedPendingBannerTimeout();
      this.derivedMetricsBanner = null;
      return;
    }

    if (!this.derivedMetricsHydrated) {
      this.clearDerivedPendingBannerTimeout();
      this.derivedMetricsBanner = null;
      return;
    }

    if (relevantStatuses.some(status => status === 'failed')) {
      this.clearDerivedPendingBannerTimeout();
      this.derivedMetricsBanner = {
        type: 'warning',
        title: 'Training metrics update failed',
        description: 'Some derived dashboard metrics could not refresh. Retry to rebuild derived metrics.',
        showRetry: true,
      };
      return;
    }

    if (relevantStatuses.some(status => status === 'missing' || isDerivedMetricPendingStatus(status))) {
      const isUsingStaleData = relevantStatuses.some(status => status === 'stale');
      const pendingBanner: DashboardDerivedMetricsBanner = {
        type: 'pending',
        title: isUsingStaleData ? 'Refreshing training metrics' : 'Building training metrics',
        description: isUsingStaleData
          ? 'Using stale derived metrics while a refresh is in progress.'
          : 'Derived dashboard metrics are being prepared in the background.',
        showRetry: false,
      };

      if (
        this.derivedMetricsBanner?.type === 'pending'
        && this.derivedMetricsBanner.title === pendingBanner.title
        && this.derivedMetricsBanner.description === pendingBanner.description
      ) {
        return;
      }

      this.clearDerivedPendingBannerTimeout();
      this.derivedPendingBannerTimeout = setTimeout(() => {
        this.derivedPendingBannerTimeout = null;
        this.derivedMetricsBanner = pendingBanner;
        this.changeDetector.markForCheck();
      }, SummariesComponent.derivedPendingBannerDebounceMs);
      return;
    }

    this.clearDerivedPendingBannerTimeout();
    this.derivedMetricsBanner = null;
  }

  private clearDerivedPendingBannerTimeout(): void {
    if (this.derivedPendingBannerTimeout) {
      clearTimeout(this.derivedPendingBannerTimeout);
      this.derivedPendingBannerTimeout = null;
    }
  }

  private getAggregationPreferences(): EventStatAggregationPreferences {
    return {
      removeAscentForEventTypes: this.user?.settings?.summariesSettings?.removeAscentForEventTypes,
      removeDescentForEventTypes: (this.user?.settings?.summariesSettings as { removeDescentForEventTypes?: unknown } | undefined)?.removeDescentForEventTypes as any,
    };
  }

  // @todo refactor
  private getRowHeight() {
    const angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    return (angle === 90 || angle === -90) ? '40vw' : '40vh';
  }

  private getNumberOfColumns() {
    if (window.innerWidth < 860) {
      return 1;
    }
    if (window.innerWidth < 1500) {
      return 2;
    }
    return 4;
  }


  getChartTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardChartTileViewModel {
    return tile as DashboardChartTileViewModel;
  }

  getMapTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardMapTileViewModel {
    return tile as DashboardMapTileViewModel;
  }

  getRecoveryNowStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardRecoveryNowChartType(tile.chartType)) {
      return null;
    }
    return this.derivedRecoveryNowStatus;
  }

  getFormStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardFormChartType(tile.chartType)) {
      return null;
    }
    return this.derivedFormStatus;
  }

  getAcwrStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardAcwrKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedAcwrStatus;
  }

  getRampRateStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardRampRateKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedRampRateStatus;
  }

  getMonotonyStrainStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardMonotonyStrainKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedMonotonyStrainStatus;
  }

  getFormNowStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardFormNowKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedFormNowStatus;
  }

  getFormPlus7dStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardFormPlus7dKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedFormPlus7dStatus;
  }

  getEasyPercentStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardEasyPercentKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedEasyPercentStatus;
  }

  getHardPercentStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardHardPercentKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedHardPercentStatus;
  }

  getEfficiencyDelta4wStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardEfficiencyDelta4wKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedEfficiencyDelta4wStatus;
  }

  getFreshnessForecastStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardFreshnessForecastChartType(tile.chartType)) {
      return null;
    }
    return this.derivedFreshnessForecastStatus;
  }

  getIntensityDistributionStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardIntensityDistributionChartType(tile.chartType)) {
      return null;
    }
    return this.derivedIntensityDistributionStatus;
  }

  getEfficiencyTrendStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardEfficiencyTrendChartType(tile.chartType)) {
      return null;
    }
    return this.derivedEfficiencyTrendStatus;
  }

  private resolveDerivedStatusForChartType(chartType: unknown): DashboardDerivedMetricStatus | null {
    if (isDashboardFormChartType(chartType)) {
      return this.derivedFormStatus;
    }
    if (isDashboardRecoveryNowChartType(chartType)) {
      return this.derivedRecoveryNowStatus;
    }
    if (isDashboardAcwrKpiChartType(chartType)) {
      return this.derivedAcwrStatus;
    }
    if (isDashboardRampRateKpiChartType(chartType)) {
      return this.derivedRampRateStatus;
    }
    if (isDashboardMonotonyStrainKpiChartType(chartType)) {
      return this.derivedMonotonyStrainStatus;
    }
    if (isDashboardFormNowKpiChartType(chartType)) {
      return this.derivedFormNowStatus;
    }
    if (isDashboardFormPlus7dKpiChartType(chartType)) {
      return this.derivedFormPlus7dStatus;
    }
    if (isDashboardEasyPercentKpiChartType(chartType)) {
      return this.derivedEasyPercentStatus;
    }
    if (isDashboardHardPercentKpiChartType(chartType)) {
      return this.derivedHardPercentStatus;
    }
    if (isDashboardEfficiencyDelta4wKpiChartType(chartType)) {
      return this.derivedEfficiencyDelta4wStatus;
    }
    if (isDashboardFreshnessForecastChartType(chartType)) {
      return this.derivedFreshnessForecastStatus;
    }
    if (isDashboardIntensityDistributionChartType(chartType)) {
      return this.derivedIntensityDistributionStatus;
    }
    if (isDashboardEfficiencyTrendChartType(chartType)) {
      return this.derivedEfficiencyTrendStatus;
    }
    return null;
  }

  private logRecoveryPipelineState(stage: string): void {
    const dashboardTiles = this.user?.settings?.dashboardSettings?.tiles ?? [];
    const hasRecoveryTile = dashboardTiles.some((tile) => {
      if (tile.type !== TileTypes.Chart) {
        return false;
      }
      const chartTile = tile as TileChartSettingsInterface;
      return isDashboardRecoveryNowChartType(chartTile.chartType);
    });
    if (!hasRecoveryTile) {
      return;
    }

    const derivedSegments = Array.isArray(this.derivedRecoveryNowContext?.segments)
      ? this.derivedRecoveryNowContext?.segments
      : [];
    this.logger.log('[debug][recovery-now] summaries_pipeline_state', {
      stage,
      hasRecoveryTile,
      dashboardEvents: this.events?.length || 0,
      derivedStatus: this.derivedRecoveryNowStatus,
      derivedAvailable: !!this.derivedRecoveryNowContext,
      derivedTotalSeconds: this.derivedRecoveryNowContext?.totalSeconds ?? null,
      derivedSegments: derivedSegments.length,
    });
  }
}
