import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DoCheck,
  HostListener,
  Inject,
  Input,
  LOCALE_ID,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { firstValueFrom, Subscription, take } from 'rxjs';
import { EventInterface } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { AppThemeService } from '../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../services/logger.service';
import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
  ActivityTypes,
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
import type { DashboardSleepTrendWindow } from '../../helpers/dashboard-sleep-chart.helper';
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
  isDashboardFatigueAtlKpiChartType,
  isDashboardFitnessCtlKpiChartType,
  isDashboardFreshnessForecastChartType,
  isDashboardFormChartType,
  isDashboardFormNowKpiChartType,
  isDashboardFormPlus7dKpiChartType,
  isDashboardHardPercentKpiChartType,
  isDashboardIntensityDistributionChartType,
  isDashboardKpiChartType,
  isDashboardMonotonyStrainKpiChartType,
  isDashboardPowerCurveChartType,
  isDashboardRampRateKpiChartType,
  isDashboardRecoveryNowChartType,
  isDashboardEventBackedSpecialChartType,
  isDashboardSpecialChartType,
} from '../../helpers/dashboard-special-chart-types';
import { MatDialog } from '@angular/material/dialog';
import { DashboardManagerDialogComponent } from './dashboard-manager-dialog/dashboard-manager-dialog.component';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import type { SleepSession } from '@shared/sleep';
import type { FirestoreRouteJSON } from '@shared/app-route.interface';
import type {
  AppDashboardChartTileDisplaySettingsInterface,
  AppDashboardChartTileSettingsInterface,
  AppDashboardDerivedChartRange,
  AppDashboardFormTimelineWindow,
  AppDashboardMapTileSettingsInterface,
  AppDashboardPowerCurveCompareMode,
  AppDashboardSettingsInterface,
  AppDashboardSleepTrendRange,
  AppDashboardTileEventFilterRange,
  AppDashboardTileEventFiltersInterface,
  AppUserInterface,
} from '../../models/app-user.interface';
import {
  dashboardSleepTrendRangeDays,
  type DashboardSleepTrendNavigationDirection,
  DASHBOARD_SLEEP_TREND_DEFAULT_RANGE,
  normalizeDashboardSleepTrendRange,
} from '../../helpers/dashboard-sleep-range.helper';
import {
  cloneDashboardTileEventFilters,
  isDashboardTileEventDurationRange,
  navigateDashboardTileEventWindow,
  normalizeDashboardTileEventFilters,
  resolveDashboardTileEventWindow,
  type DashboardTileEventNavigationDirection,
} from '../../helpers/dashboard-tile-event-filters.helper';
import {
  cloneDashboardChartTileDisplaySettingsForChartType,
  normalizeDashboardChartTileDisplaySettingsForChartType,
  normalizeDashboardFormTimelineWindow,
} from '../../helpers/dashboard-chart-display-settings.helper';
import { normalizeDashboardDerivedChartRange } from '../../helpers/dashboard-derived-chart-range.helper';
import { normalizeDashboardPowerCurveCompareMode } from '../../helpers/dashboard-power-curve.helper';
import {
  getSparseEqualWidthDashboardGridLayout,
  type SparseEqualWidthDashboardGridLayout,
  getTrailingDashboardGridPlaceholderCount,
} from '../../helpers/dashboard-grid-layout.helper';
import {
  DASHBOARD_TILE_SECTION_ORDER,
  type DashboardTileSectionId,
  getDashboardTileSectionDefinition,
  orderDashboardTilesByIntentSections,
  resolveDashboardTileSection,
} from '../../helpers/dashboard-tile-section.helper';
import { AppEventService } from '../../services/app.event.service';
import { AppRouteService } from '../../services/app.route.service';
import { DashboardAutoTileService } from '../../services/dashboard-auto-tile.service';
import { WhereFilterOp } from 'firebase/firestore';

interface DashboardDerivedMetricsBanner {
  type: 'pending' | 'warning';
  title: string;
  description: string;
  showRetry: boolean;
}

interface DashboardTileSectionViewModel {
  id: DashboardTileSectionId;
  label: string;
  icon: string;
  columns: number;
  tiles: DashboardTileViewModel[];
  cells: DashboardTileSectionCellViewModel[];
  trailingPlaceholders: number[];
}

interface DashboardTileSectionCellViewModel {
  tile: DashboardTileViewModel;
  columns: number;
}

interface DashboardTileEventSubscriptionState {
  order: number;
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

  @Input() user: User;
  @Input() eventUser: User;
  @Input() showActions: boolean;

  public rowHeight;
  public numberOfCols: number;


  public tiles: DashboardTileViewModel[] = [];
  public kpiLaneTiles: DashboardChartTileViewModel[] = [];
  public mainGridTiles: DashboardTileViewModel[] = [];
  public mainGridSections: DashboardTileSectionViewModel[] = [];

  public tileTypes = TileTypes;
  public desktopTileDragEnabled = false;
  public isDashboardManagerOpen = false;
  public sleepTrendRange: AppDashboardSleepTrendRange = DASHBOARD_SLEEP_TREND_DEFAULT_RANGE;
  public sleepTrendWindowLabel = 'Last 14 days';
  public sleepTrendCanNavigateOlder = true;
  public sleepTrendCanNavigateNewer = false;
  public todayDateSubtitle = '';

  private appThemeSubscription: Subscription | null = null;
  private derivedMetricsSubscription: Subscription | null = null;
  private derivedMetricsUserUID: string | null = null;
  private sleepSubscription: Subscription | null = null;
  private sleepListenerKey: string | null = null;
  private dashboardAutoTileSubscription: Subscription | null = null;
  private dashboardAutoTileListenerKey: string | null = null;
  private dashboardAutoTileUser: AppUserInterface | null = null;
  private sleepTrendAnchorEndMs: number | null = null;
  private tileEventSubscriptions = new Map<number, Subscription>();
  private tileEventSubscriptionStates = new Map<number, DashboardTileEventSubscriptionState>();
  private tileEventListenerKeys = new Map<number, string>();
  private tileEventAnchorEndMsByOrder = new Map<number, number | null>();
  private tileEventsByOrder: Record<number, EventInterface[]> = {};
  public tileEventLoadingByOrder: Record<number, boolean> = {};
  private routePreviewSubscription: Subscription | null = null;
  private routePreviewListenerKey: string | null = null;
  private routePreviewRoutes: FirestoreRouteJSON[] = [];
  public routePreviewLoading = false;
  public darkTheme = false;
  private logger: LoggerService;
  private dashboardTileSettingsSnapshot: TileSettingsInterface[] = [];
  private sleepSessions: SleepSession[] = [];
  private sleepTrendWindow: DashboardSleepTrendWindow | null = null;
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
    private eventService: AppEventService,
    private routeService: AppRouteService,
    private dashboardAutoTileService: DashboardAutoTileService,
    private dialog: MatDialog,
    changeDetector: ChangeDetectorRef,
    logger: LoggerService,
    @Inject(LOCALE_ID) private locale: string,
  ) {
    super(changeDetector);
    this.logger = logger;
    this.rowHeight = this.getRowHeight();
    this.numberOfCols = this.getNumberOfColumns();
    this.todayDateSubtitle = this.formatTodayDateSubtitle(new Date());
  }

  @HostListener('window:resize', ['$event'])
  @HostListener('window:orientationchange', ['$event'])
  resizeOROrientationChange() {
    this.numberOfCols = this.getNumberOfColumns();
    this.rowHeight = this.getRowHeight();
    this.refreshMainGridSectionLayout();
    this.updateDesktopTileDragCapability();
  }

  ngOnInit() {
    this.updateDesktopTileDragCapability();
  }

  async ngOnChanges(simpleChanges: SimpleChanges) {
    this.updateDesktopTileDragCapability();
    if (
      simpleChanges.user
      || simpleChanges.eventUser
    ) {
      const previousUser = (simpleChanges.user?.previousValue ?? this.user) as User | null;
      const previousEventUser = (simpleChanges.eventUser?.previousValue ?? this.eventUser) as User | null;
      const previousDependencySnapshot = this.getDashboardInputDependencySnapshot(previousUser, previousEventUser);
      const currentDependencySnapshot = this.getDashboardInputDependencySnapshot(this.user, this.eventUser);
      const nextTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
      const isFirstInputChange = simpleChanges.user?.firstChange === true
        || simpleChanges.eventUser?.firstChange === true
        || simpleChanges.user?.isFirstChange?.() === true
        || simpleChanges.eventUser?.isFirstChange?.() === true;
      if (
        !isFirstInputChange
        && equal(previousDependencySnapshot, currentDependencySnapshot)
        && equal(this.dashboardTileSettingsSnapshot, nextTileSettingsSnapshot)
      ) {
        this.syncDashboardAutoTileSubscription();
        return;
      }
      return this.unsubscribeAndCreateCharts();
    }
    if (simpleChanges.showActions) {
      this.syncDashboardAutoTileSubscription();
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
    const mapSource = mapItem.mapSource === 'routes' ? 'routes' : 'events';
    return `${mapItem.clusterMarkers}${mapItem.showRouteEndpointMarkers}${mapItem.mapTheme}${mapItem.mapStyle}${mapSource}${mapItem.name}${mapItem.order}${mapItem.showHeatMap}${mapItem.routePreviews?.length || 0}`;
  }

  public trackBySection(_index: number, item: DashboardTileSectionViewModel): DashboardTileSectionId {
    return item.id;
  }

  private formatTodayDateSubtitle(date: Date): string {
    try {
      return new Intl.DateTimeFormat(this.locale || undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date);
    } catch {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date);
    }
  }

  public async onTilesDrop(event: CdkDragDrop<DashboardTileViewModel[]>, sectionId: DashboardTileSectionId): Promise<void> {
    this.ensureTileLanesInitializedFromTiles();
    const section = this.mainGridSections.find(candidate => candidate.id === sectionId);
    if (
      !section
      || !this.desktopTileDragEnabled
      || !this.showActions
      || section.tiles.length < 2
      || !this.isValidDragReorder(section.tiles, event.previousIndex, event.currentIndex)
    ) {
      return;
    }
    moveItemInArray(section.tiles, event.previousIndex, event.currentIndex);
    this.syncTilesFromLanesForDrop();
    await this.persistLaneOrder();
  }

  public async onKpiTilesDrop(event: CdkDragDrop<DashboardChartTileViewModel[]>): Promise<void> {
    this.ensureTileLanesInitializedFromTiles();
    if (
      !this.desktopTileDragEnabled
      || !this.showActions
      || this.kpiLaneTiles.length < 2
      || !this.isValidDragReorder(this.kpiLaneTiles, event.previousIndex, event.currentIndex)
    ) {
      return;
    }
    moveItemInArray(this.kpiLaneTiles, event.previousIndex, event.currentIndex);
    this.syncTilesFromLanesForDrop();
    await this.persistLaneOrder();
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

    this.setDashboardManagerOpenState(true);

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
      dialogRef.beforeClosed?.().pipe(take(1)).subscribe(() => {
        this.setDashboardManagerOpenState(false);
      });
      const result = await firstValueFrom(dialogRef.afterClosed().pipe(take(1)));
      if (result?.saved === true) {
        await this.rebuildTilesFromCurrentState();
      }
    } finally {
      this.setDashboardManagerOpenState(false);
    }
  }

  private setDashboardManagerOpenState(isOpen: boolean): void {
    if (this.isDashboardManagerOpen === isOpen) {
      return;
    }
    this.isDashboardManagerOpen = isOpen;
    this.changeDetector.markForCheck();
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
    this.syncDashboardAutoTileSubscription();
    this.syncTileEventSubscriptions();
    this.syncRoutePreviewSubscription();
    await this.rebuildTilesFromCurrentState();
  }

  private async rebuildTilesFromCurrentState(): Promise<void> {
    const buildStart = performance.now();
    this.refreshDerivedMetricsBannerState();
    const newTiles = buildDashboardTileViewModels({
      tiles: this.user?.settings?.dashboardSettings?.tiles ?? [],
      events: [],
      tileEventsByOrder: this.tileEventsByOrder,
      routePreviews: this.routePreviewRoutes,
      sleepSessions: this.sleepSessions,
      sleepTrendWindow: this.sleepTrendWindow,
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
      inputEvents: Object.values(this.tileEventsByOrder).reduce((total, events) => total + (events?.length || 0), 0),
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

    const hadPreviousSleepListener = this.sleepListenerKey !== null;
    if (this.sleepSubscription) {
      this.sleepSubscription.unsubscribe();
      this.sleepSubscription = null;
    }

    let shouldRebuildForWindowChange = hadPreviousSleepListener;
    this.sleepListenerKey = listenerKey;
    this.sleepSubscription = this.sleepService
      .watchForDashboard(uid, window.startMs, window.endMs)
      .subscribe((sessions) => {
        const sessionsChanged = !equal(this.sleepSessions, sessions);
        if (!sessionsChanged && !shouldRebuildForWindowChange) {
          return;
        }
        if (sessionsChanged) {
          this.sleepSessions = sessions;
        }
        shouldRebuildForWindowChange = false;
        void this.rebuildTilesFromCurrentState();
      });
  }

  private syncDashboardAutoTileSubscription(): void {
    const listenerKey = this.resolveDashboardAutoTileListenerKey();
    if (!listenerKey) {
      this.unsubscribeDashboardAutoTileSubscription();
      return;
    }

    const user = this.user as AppUserInterface;
    if (
      this.dashboardAutoTileListenerKey === listenerKey
      && this.dashboardAutoTileSubscription
      && this.dashboardAutoTileUser === user
    ) {
      return;
    }

    this.unsubscribeDashboardAutoTileSubscription();
    this.dashboardAutoTileListenerKey = listenerKey;
    this.dashboardAutoTileUser = user;
    this.dashboardAutoTileSubscription = this.dashboardAutoTileService.watchForDashboard(user);
  }

  private resolveDashboardAutoTileListenerKey(): string | null {
    return this.resolveOwnDashboardUID();
  }

  private resolveOwnDashboardUID(): string | null {
    if (this.showActions !== true) {
      return null;
    }

    const uid = `${this.user?.uid || ''}`.trim();
    if (!uid) {
      return null;
    }

    const eventUserUID = `${this.eventUser?.uid || ''}`.trim();
    if (eventUserUID && eventUserUID !== uid) {
      return null;
    }

    return uid;
  }

  private unsubscribeDashboardAutoTileSubscription(): void {
    if (this.dashboardAutoTileSubscription) {
      this.dashboardAutoTileSubscription.unsubscribe();
      this.dashboardAutoTileSubscription = null;
    }
    this.dashboardAutoTileListenerKey = null;
    this.dashboardAutoTileUser = null;
  }

  private persistDashboardSettings(dashboardSettings: Partial<AppDashboardSettingsInterface>): Promise<void> {
    if (!this.user) {
      return Promise.resolve();
    }

    return this.userService.updateUserProperties(this.user as AppUserInterface, {
      settings: { dashboardSettings },
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
      await this.persistDashboardSettings({
        sleepTrend: dashboardSettings.sleepTrend,
      });
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

  public getTileEventFilters(tile: DashboardTileViewModel): AppDashboardTileEventFiltersInterface {
    return normalizeDashboardTileEventFilters((tile as DashboardTileViewModel & {
      eventFilters?: AppDashboardTileEventFiltersInterface;
    }).eventFilters);
  }

  public isTileLoading(tile: DashboardTileViewModel): boolean {
    if (this.isRoutePreviewMapTile(tile)) {
      return this.routePreviewLoading;
    }
    if (this.isEventDataTile(tile)) {
      return this.tileEventLoadingByOrder[tile.order] === true;
    }
    if (this.isKpiLaneTile(tile)) {
      return !this.derivedMetricsHydrated;
    }
    return false;
  }

  public canNavigateTileEventsNewer(tile: DashboardTileViewModel): boolean {
    return this.tileEventAnchorEndMsByOrder.has(tile.order)
      && this.tileEventAnchorEndMsByOrder.get(tile.order) !== null;
  }

  public async onTileEventFilterRangeChange(
    order: number,
    range: AppDashboardTileEventFilterRange,
  ): Promise<void> {
    if (range === 'all') {
      const confirmed = await this.confirmAllTileEventRangeSelection();
      if (!confirmed) {
        return;
      }
    }
    await this.updateTileEventFilters(order, { range });
  }

  public async onTileEventFilterActivityTypesChange(order: number, activityTypes: ActivityTypes[]): Promise<void> {
    await this.updateTileEventFilters(order, { activityTypes: activityTypes || [] });
  }

  public onTileEventFilterNavigate(order: number, direction: DashboardTileEventNavigationDirection): void {
    const tile = this.getOrderedDashboardSettingsTiles().find(candidate => candidate.order === order);
    if (!tile || !this.isEventDataSettingsTile(tile)) {
      return;
    }
    const filters = this.getSettingsTileEventFilters(tile);
    const nextAnchor = navigateDashboardTileEventWindow(
      filters,
      direction,
      this.tileEventAnchorEndMsByOrder.get(order) ?? null,
    );
    this.tileEventAnchorEndMsByOrder.set(order, nextAnchor);
    this.syncTileEventSubscriptions();
    this.changeDetector.markForCheck();
  }

  public async onTileDerivedChartRangeChange(
    order: number,
    range: AppDashboardDerivedChartRange,
  ): Promise<void> {
    await this.updateTileDisplaySettings(order, {
      derivedChartRange: normalizeDashboardDerivedChartRange(range) as AppDashboardDerivedChartRange,
    });
  }

  public async onTileFormTimelineWindowChange(
    order: number,
    timelineWindow: AppDashboardFormTimelineWindow,
  ): Promise<void> {
    await this.updateTileDisplaySettings(order, {
      formTimelineWindow: normalizeDashboardFormTimelineWindow(timelineWindow),
    });
  }

  public async onTilePowerCurveCompareModeChange(
    order: number,
    compareMode: AppDashboardPowerCurveCompareMode,
  ): Promise<void> {
    await this.updateTileDisplaySettings(order, {
      powerCurveCompareMode: normalizeDashboardPowerCurveCompareMode(compareMode),
    });
  }

  private syncTileEventSubscriptions(): void {
    const eventUser = (this.eventUser || this.user) as User | null;
    const uid = `${eventUser?.uid || ''}`.trim();
    if (!uid) {
      this.unsubscribeTileEventSubscriptions();
      return;
    }

    const eventDataTiles = this.getOrderedDashboardSettingsTiles().filter(tile => this.isEventDataSettingsTile(tile));
    const activeOrders = new Set(eventDataTiles.map(tile => tile.order));
    for (const order of Array.from(this.tileEventSubscriptions.keys())) {
      if (!activeOrders.has(order)) {
        this.tileEventSubscriptions.get(order)?.unsubscribe();
        this.tileEventSubscriptions.delete(order);
        this.tileEventSubscriptionStates.delete(order);
        this.tileEventListenerKeys.delete(order);
        this.tileEventAnchorEndMsByOrder.delete(order);
        delete this.tileEventsByOrder[order];
        delete this.tileEventLoadingByOrder[order];
      }
    }

    eventDataTiles.forEach((tile) => {
      const filters = this.getSettingsTileEventFilters(tile);
      const window = resolveDashboardTileEventWindow(
        filters,
        this.user?.settings?.unitSettings?.startOfTheWeek,
        this.tileEventAnchorEndMsByOrder.get(tile.order) ?? null,
      );
      const listenerKey = this.buildTileEventListenerKey(uid, tile.order, filters, window);
      if (this.tileEventListenerKeys.get(tile.order) === listenerKey && this.tileEventSubscriptions.has(tile.order)) {
        return;
      }

      this.tileEventSubscriptions.get(tile.order)?.unsubscribe();
      this.tileEventSubscriptionStates.delete(tile.order);
      this.tileEventListenerKeys.set(tile.order, listenerKey);
      this.tileEventLoadingByOrder[tile.order] = true;
      const subscriptionState: DashboardTileEventSubscriptionState = { order: tile.order };
      this.tileEventSubscriptionStates.set(tile.order, subscriptionState);

      const where = this.buildTileEventWhereClauses(window);
      this.tileEventSubscriptions.set(tile.order, this.eventService
        .getEventsBy(eventUser, where, 'startDate', false, 0)
        .subscribe({
          next: (events) => {
            const currentOrder = subscriptionState.order;
            this.tileEventsByOrder[currentOrder] = (events || []).filter(event => !event.isMerge);
            this.tileEventLoadingByOrder[currentOrder] = false;
            void this.rebuildTilesFromCurrentState();
            this.changeDetector.markForCheck();
          },
          error: (error) => {
            const currentOrder = subscriptionState.order;
            this.tileEventsByOrder[currentOrder] = [];
            this.tileEventLoadingByOrder[currentOrder] = false;
            this.logger.error('[SummariesComponent] Failed to load dashboard tile events', error);
            void this.rebuildTilesFromCurrentState();
            this.changeDetector.markForCheck();
          },
        }));
    });
  }

  private syncRoutePreviewSubscription(): void {
    const eventUser = (this.eventUser || this.user) as User | null;
    const uid = `${eventUser?.uid || ''}`.trim();
    const hasRouteMapTile = this.getOrderedDashboardSettingsTiles().some(tile => this.isRoutePreviewMapSettingsTile(tile));
    if (!uid || !hasRouteMapTile) {
      this.unsubscribeRoutePreviewSubscription();
      return;
    }

    const listenerKey = `${uid}:recent-route-previews`;
    if (this.routePreviewListenerKey === listenerKey && this.routePreviewSubscription) {
      return;
    }

    this.unsubscribeRoutePreviewSubscription();
    this.routePreviewListenerKey = listenerKey;
    this.routePreviewLoading = true;
    this.routePreviewSubscription = this.routeService.watchRecentRoutePreviews(eventUser, 50).subscribe({
      next: (routes) => {
        this.routePreviewRoutes = routes || [];
        this.routePreviewLoading = false;
        void this.rebuildTilesFromCurrentState();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.routePreviewRoutes = [];
        this.routePreviewLoading = false;
        this.logger.error('[SummariesComponent] Failed to load dashboard route previews', error);
        void this.rebuildTilesFromCurrentState();
        this.changeDetector.markForCheck();
      },
    });
  }

  private unsubscribeRoutePreviewSubscription(): void {
    if (this.routePreviewSubscription) {
      this.routePreviewSubscription.unsubscribe();
      this.routePreviewSubscription = null;
    }
    this.routePreviewListenerKey = null;
    this.routePreviewRoutes = [];
    this.routePreviewLoading = false;
  }

  private buildTileEventWhereClauses(window: { startMs: number | null; endMs: number | null }): Array<{ fieldPath: string; opStr: WhereFilterOp; value: number }> {
    if (window.startMs === null || window.endMs === null) {
      return [];
    }
    return [{
      fieldPath: 'startDate',
      opStr: '>=',
      value: window.startMs,
    }, {
      fieldPath: 'startDate',
      opStr: '<=',
      value: window.endMs,
    }];
  }

  private buildTileEventListenerKey(
    uid: string,
    order: number,
    filters: AppDashboardTileEventFiltersInterface,
    window: { startMs: number | null; endMs: number | null },
  ): string {
    const range = normalizeDashboardTileEventFilters(filters).range;
    const anchorEndMs = this.tileEventAnchorEndMsByOrder.get(order) ?? null;
    const windowKey = isDashboardTileEventDurationRange(range) && anchorEndMs === null
      ? 'latest'
      : `${window.startMs}:${window.endMs}`;
    return JSON.stringify({
      uid,
      order,
      range,
      windowKey,
    });
  }

  private remapTileEventStateForOrderChange(orderRemap: Map<number, number>): void {
    if (!orderRemap.size) {
      return;
    }

    const nextSubscriptions = new Map<number, Subscription>();
    const nextSubscriptionStates = new Map<number, DashboardTileEventSubscriptionState>();
    this.tileEventSubscriptions.forEach((subscription, previousOrder) => {
      const nextOrder = orderRemap.get(previousOrder);
      if (nextOrder === undefined) {
        subscription.unsubscribe();
        return;
      }
      nextSubscriptions.set(nextOrder, subscription);
      const subscriptionState = this.tileEventSubscriptionStates.get(previousOrder);
      if (subscriptionState) {
        subscriptionState.order = nextOrder;
        nextSubscriptionStates.set(nextOrder, subscriptionState);
      }
    });

    const nextAnchorEndMsByOrder = new Map<number, number | null>();
    this.tileEventAnchorEndMsByOrder.forEach((anchorEndMs, previousOrder) => {
      const nextOrder = orderRemap.get(previousOrder);
      if (nextOrder !== undefined) {
        nextAnchorEndMsByOrder.set(nextOrder, anchorEndMs);
      }
    });

    const nextEventsByOrder: Record<number, EventInterface[]> = {};
    Object.entries(this.tileEventsByOrder).forEach(([previousOrderKey, events]) => {
      const nextOrder = orderRemap.get(Number(previousOrderKey));
      if (nextOrder !== undefined) {
        nextEventsByOrder[nextOrder] = events;
      }
    });

    const nextLoadingByOrder: Record<number, boolean> = {};
    Object.entries(this.tileEventLoadingByOrder).forEach(([previousOrderKey, loading]) => {
      const nextOrder = orderRemap.get(Number(previousOrderKey));
      if (nextOrder !== undefined) {
        nextLoadingByOrder[nextOrder] = loading;
      }
    });

    this.tileEventSubscriptions = nextSubscriptions;
    this.tileEventSubscriptionStates = nextSubscriptionStates;
    this.tileEventAnchorEndMsByOrder = nextAnchorEndMsByOrder;
    this.tileEventsByOrder = nextEventsByOrder;
    this.tileEventLoadingByOrder = nextLoadingByOrder;
    this.refreshTileEventListenerKeysForCurrentSettings();
  }

  private refreshTileEventListenerKeysForCurrentSettings(): void {
    const eventUser = (this.eventUser || this.user) as User | null;
    const uid = `${eventUser?.uid || ''}`.trim();
    if (!uid) {
      this.tileEventListenerKeys.clear();
      return;
    }

    const nextListenerKeys = new Map<number, string>();
    this.getOrderedDashboardSettingsTiles()
      .filter(tile => this.isEventDataSettingsTile(tile))
      .forEach((tile) => {
        if (!this.tileEventSubscriptions.has(tile.order)) {
          return;
        }
        const filters = this.getSettingsTileEventFilters(tile);
        const window = resolveDashboardTileEventWindow(
          filters,
          this.user?.settings?.unitSettings?.startOfTheWeek,
          this.tileEventAnchorEndMsByOrder.get(tile.order) ?? null,
        );
        nextListenerKeys.set(tile.order, this.buildTileEventListenerKey(uid, tile.order, filters, window));
      });

    this.tileEventListenerKeys = nextListenerKeys;
  }

  private async updateTileEventFilters(
    order: number,
    patch: Partial<AppDashboardTileEventFiltersInterface>,
  ): Promise<void> {
    if (!this.user?.settings?.dashboardSettings?.tiles) {
      return;
    }

    const dashboardSettings = (this.user as AppUserInterface).settings.dashboardSettings as AppDashboardSettingsInterface;
    const previousTiles = this.cloneDashboardTiles(dashboardSettings.tiles);
    const tile = dashboardSettings.tiles.find(candidate => candidate.order === order);
    if (!tile || !this.isEventDataSettingsTile(tile)) {
      return;
    }

    const tileWithFilters = tile as (AppDashboardChartTileSettingsInterface | AppDashboardMapTileSettingsInterface);
    const previousFilters = this.getSettingsTileEventFilters(tileWithFilters);
    tileWithFilters.eventFilters = normalizeDashboardTileEventFilters({
      ...previousFilters,
      ...patch,
    });
    this.tileEventAnchorEndMsByOrder.delete(order);
    this.syncTileEventSubscriptions();
    await this.rebuildTilesFromCurrentState();
    this.changeDetector.markForCheck();

    try {
      await this.persistDashboardSettings({
        tiles: dashboardSettings.tiles,
      });
    } catch (error) {
      dashboardSettings.tiles = previousTiles;
      this.tileEventAnchorEndMsByOrder.delete(order);
      this.syncTileEventSubscriptions();
      await this.rebuildTilesFromCurrentState();
      this.changeDetector.markForCheck();
      this.logger.error('[SummariesComponent] Failed to persist dashboard tile event filters', error);
    }
  }

  private async updateTileDisplaySettings(
    order: number,
    patch: Partial<AppDashboardChartTileDisplaySettingsInterface>,
  ): Promise<void> {
    if (!this.user?.settings?.dashboardSettings?.tiles) {
      return;
    }

    const dashboardSettings = (this.user as AppUserInterface).settings.dashboardSettings as AppDashboardSettingsInterface;
    const previousTiles = this.cloneDashboardTiles(dashboardSettings.tiles);
    const tile = dashboardSettings.tiles.find(candidate => candidate.order === order);
    if (!tile || !this.isDisplaySettingsChartTile(tile)) {
      return;
    }

    const previousDisplaySettings = this.getSettingsTileDisplaySettings(tile);
    const nextDisplaySettings = this.getSettingsTileDisplaySettings(tile, {
      ...previousDisplaySettings,
      ...patch,
    });
    if (equal(previousDisplaySettings, nextDisplaySettings)) {
      return;
    }

    tile.displaySettings = nextDisplaySettings;
    await this.rebuildTilesFromCurrentState();
    this.changeDetector.markForCheck();

    try {
      await this.persistDashboardSettings({
        tiles: dashboardSettings.tiles,
      });
    } catch (error) {
      dashboardSettings.tiles = previousTiles;
      await this.rebuildTilesFromCurrentState();
      this.changeDetector.markForCheck();
      this.logger.error('[SummariesComponent] Failed to persist dashboard tile display settings', error);
    }
  }

  private getSettingsTileEventFilters(tile: TileSettingsInterface): AppDashboardTileEventFiltersInterface {
    return normalizeDashboardTileEventFilters((tile as (AppDashboardChartTileSettingsInterface | AppDashboardMapTileSettingsInterface)).eventFilters);
  }

  private getSettingsTileDisplaySettings(
    tile: AppDashboardChartTileSettingsInterface,
    value: unknown = tile.displaySettings,
  ): AppDashboardChartTileDisplaySettingsInterface {
    return normalizeDashboardChartTileDisplaySettingsForChartType(tile.chartType, value, true) || {};
  }

  private isEventDataTile(tile: DashboardTileViewModel): boolean {
    if (tile.type === TileTypes.Map) {
      return !this.isRoutePreviewMapTile(tile);
    }
    return tile.type === TileTypes.Chart && (
      !isDashboardSpecialChartType((tile as DashboardChartTileViewModel).chartType)
      || isDashboardEventBackedSpecialChartType((tile as DashboardChartTileViewModel).chartType)
    );
  }

  private isEventDataSettingsTile(tile: TileSettingsInterface): boolean {
    if (tile.type === TileTypes.Map) {
      return !this.isRoutePreviewMapSettingsTile(tile);
    }
    return tile.type === TileTypes.Chart && (
      !isDashboardSpecialChartType((tile as TileChartSettingsInterface).chartType)
      || isDashboardEventBackedSpecialChartType((tile as TileChartSettingsInterface).chartType)
    );
  }

  private isRoutePreviewMapTile(tile: DashboardTileViewModel): boolean {
    return tile.type === TileTypes.Map
      && (tile as DashboardMapTileViewModel).mapSource === 'routes';
  }

  private isRoutePreviewMapSettingsTile(tile: TileSettingsInterface): boolean {
    return tile.type === TileTypes.Map
      && (tile as AppDashboardMapTileSettingsInterface).mapSource === 'routes';
  }

  private isDisplaySettingsChartTile(tile: TileSettingsInterface): tile is AppDashboardChartTileSettingsInterface {
    if (tile.type !== TileTypes.Chart) {
      return false;
    }
    const chartType = (tile as TileChartSettingsInterface).chartType;
    return isDashboardFormChartType(chartType)
      || isDashboardIntensityDistributionChartType(chartType)
      || isDashboardEfficiencyTrendChartType(chartType)
      || isDashboardPowerCurveChartType(chartType);
  }

  private cloneDashboardTiles(tiles: TileSettingsInterface[]): TileSettingsInterface[] {
    return (tiles || []).map((tile) => this.cloneDashboardTile(tile));
  }

  private async confirmAllTileEventRangeSelection(): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Load all tile events?',
        message: 'Selecting All may degrade app performance and increase loading times. Continue?',
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      },
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed().pipe(take(1)));
    return confirmed === true;
  }

  private buildSleepListenerKey(uid: string, window: { range: AppDashboardSleepTrendRange; startMs: number; endMs: number }): string {
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
  } {
    const range = this.sleepTrendRange || this.getSleepTrendRange();
    const days = dashboardSleepTrendRangeDays(range);
    const windowMs = days * 24 * 60 * 60 * 1000;
    const anchorEndMs = Number.isFinite(this.sleepTrendAnchorEndMs) && this.sleepTrendAnchorEndMs !== null
      ? Math.min(this.sleepTrendAnchorEndMs, nowMs)
      : nowMs;
    return {
      range,
      startMs: Math.max(0, anchorEndMs - windowMs),
      endMs: anchorEndMs,
    };
  }

  private updateSleepTrendWindowState(window: { range: AppDashboardSleepTrendRange; startMs: number; endMs: number }): void {
    this.sleepTrendWindow = window;
    this.sleepTrendRange = window.range;
    this.sleepTrendCanNavigateOlder = true;
    this.sleepTrendCanNavigateNewer = this.sleepTrendAnchorEndMs !== null;
    this.sleepTrendWindowLabel = this.formatSleepTrendWindowLabel(window);
  }

  private formatSleepTrendWindowLabel(window: { range: AppDashboardSleepTrendRange; startMs: number; endMs: number }): string {
    const days = dashboardSleepTrendRangeDays(window.range);
    if (this.sleepTrendAnchorEndMs === null) {
      if (window.range === '1y') {
        return 'Last 1 year';
      }
      return `Last ${days} days`;
    }
    return `${this.formatSleepTrendWindowDate(window.startMs)} - ${this.formatSleepTrendWindowDate(window.endMs)}`;
  }

  private formatSleepTrendWindowDate(timestampMs: number): string {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
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
      const snapshot = this.cloneDashboardTile(tile);

      if (tile.type !== TileTypes.Chart) {
        return snapshot;
      }

      return {
        ...snapshot,
        dataTimeInterval: (tile as TileChartSettingsInterface).dataTimeInterval || TimeIntervals.Auto
      } as TileChartSettingsInterface;
    });
  }

  private cloneDashboardTile(tile: TileSettingsInterface): TileSettingsInterface {
    const clonedTile = {
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size,
    } as TileSettingsInterface & {
      eventFilters?: AppDashboardTileEventFiltersInterface;
      displaySettings?: AppDashboardChartTileDisplaySettingsInterface;
    };
    const eventFilters = cloneDashboardTileEventFilters(
      (tile as AppDashboardChartTileSettingsInterface | AppDashboardMapTileSettingsInterface).eventFilters,
    );
    if (eventFilters) {
      clonedTile.eventFilters = eventFilters;
    } else {
      delete clonedTile.eventFilters;
    }
    if (tile.type === TileTypes.Chart) {
      const chartTile = tile as AppDashboardChartTileSettingsInterface;
      const displaySettings = cloneDashboardChartTileDisplaySettingsForChartType(
        chartTile.chartType,
        chartTile.displaySettings,
      );
      if (displaySettings) {
        clonedTile.displaySettings = displaySettings;
      } else {
        delete clonedTile.displaySettings;
      }
    }
    return clonedTile as TileSettingsInterface;
  }

  private getOrderedDashboardSettingsTiles(): TileSettingsInterface[] {
    return [...(this.user?.settings?.dashboardSettings?.tiles ?? [])]
      .sort((left, right) => left.order - right.order);
  }

  private updateDesktopTileDragCapability(): void {
    this.ensureTileLanesInitializedFromTiles();
    const hasDraggableLane = this.mainGridSections.some(section => section.tiles.length > 1)
      || this.kpiLaneTiles.length > 1;
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
    return tiles.map((tile: TileSettingsInterface) => this.cloneDashboardTile(tile));
  }

  private cloneDashboardViewModels(tiles: DashboardTileViewModel[]): DashboardTileViewModel[] {
    return tiles.map((tile: DashboardTileViewModel) => {
      const clonedTile = {
        ...tile,
        size: tile.size ? { ...tile.size } : tile.size,
      } as DashboardTileViewModel & { displaySettings?: AppDashboardChartTileDisplaySettingsInterface };
      if (isDashboardChartTileViewModel(tile)) {
        const chartTile = tile as AppDashboardChartTileSettingsInterface;
        const displaySettings = cloneDashboardChartTileDisplaySettingsForChartType(
          chartTile.chartType,
          chartTile.displaySettings,
        );
        if (displaySettings) {
          clonedTile.displaySettings = displaySettings;
        } else {
          delete clonedTile.displaySettings;
        }
      }
      return clonedTile;
    }) as DashboardTileViewModel[];
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
    this.refreshMainGridSections();
  }

  private ensureTileLanesInitializedFromTiles(): void {
    const sectionTileCount = this.mainGridSections.reduce((total, section) => total + section.tiles.length, 0);
    if (
      (this.kpiLaneTiles.length + this.mainGridTiles.length) !== this.tiles.length
      || sectionTileCount !== this.mainGridTiles.length
    ) {
      this.refreshTileLanes();
    }
  }

  private syncTilesFromLanesForDrop(): void {
    this.mainGridTiles = this.getFlattenedMainGridSectionTiles();
    this.tiles = [...this.kpiLaneTiles, ...this.mainGridTiles];
    this.refreshMainGridSections();
  }

  private isValidDragReorder<T>(items: T[], previousIndex: number, currentIndex: number): boolean {
    return Number.isInteger(previousIndex)
      && Number.isInteger(currentIndex)
      && previousIndex !== currentIndex
      && previousIndex >= 0
      && currentIndex >= 0
      && previousIndex < items.length
      && currentIndex < items.length;
  }

  private refreshMainGridSections(): void {
    const tilesBySection = new Map<DashboardTileSectionId, DashboardTileViewModel[]>();
    this.mainGridTiles.forEach((tile) => {
      const sectionId = resolveDashboardTileSection(tile);
      tilesBySection.set(sectionId, [...(tilesBySection.get(sectionId) || []), tile]);
    });

    this.mainGridSections = DASHBOARD_TILE_SECTION_ORDER
      .map((sectionId) => {
        const definition = getDashboardTileSectionDefinition(sectionId);
        const sectionTiles = tilesBySection.get(sectionId) || [];
        const sectionColumns = this.buildMainGridSectionColumnCount(sectionTiles, sectionId);
        const sectionCells = this.buildMainGridSectionCells(sectionTiles, sectionColumns, sectionId);
        return {
          ...definition,
          columns: sectionColumns,
          tiles: sectionTiles,
          cells: sectionCells,
          trailingPlaceholders: this.buildMainGridTrailingPlaceholders(sectionCells, sectionColumns),
        };
      })
      .filter(section => section.tiles.length > 0);
  }

  private refreshMainGridSectionLayout(): void {
    this.mainGridSections = this.mainGridSections.map((section) => {
      const sectionColumns = this.buildMainGridSectionColumnCount(section.tiles, section.id);
      const sectionCells = this.buildMainGridSectionCells(section.tiles, sectionColumns, section.id);
      return {
        ...section,
        columns: sectionColumns,
        cells: sectionCells,
        trailingPlaceholders: this.buildMainGridTrailingPlaceholders(sectionCells, sectionColumns),
      };
    });
  }

  private buildMainGridSectionCells(
    tiles: DashboardTileViewModel[],
    sectionColumns: number,
    sectionId: DashboardTileSectionId,
  ): DashboardTileSectionCellViewModel[] {
    const balancedRoutesMapLayout = this.getBalancedRoutesMapSectionLayout(tiles, sectionColumns, sectionId);
    return tiles.map(tile => ({
      tile,
      columns: balancedRoutesMapLayout?.itemColumns
        || Math.min(this.getTilePersistedColumns(tile), sectionColumns),
    }));
  }

  private buildMainGridTrailingPlaceholders(
    cells: DashboardTileSectionCellViewModel[],
    sectionColumns: number,
  ): number[] {
    if (cells.length < 2) {
      return [];
    }

    const placeholderCount = getTrailingDashboardGridPlaceholderCount(
      cells.map(cell => ({
        size: {
          columns: cell.columns,
          rows: cell.tile.size?.rows,
        },
      })),
      sectionColumns,
    );
    return Array.from({ length: placeholderCount }, (_, index) => index);
  }

  private buildMainGridSectionColumnCount(
    tiles: DashboardTileViewModel[],
    sectionId: DashboardTileSectionId,
  ): number {
    const maxColumns = this.normalizeGridColumnCount(this.numberOfCols);
    if (!tiles.length || maxColumns <= 1) {
      return 1;
    }

    const balancedRoutesMapLayout = this.getBalancedRoutesMapSectionLayout(tiles, maxColumns, sectionId);
    if (balancedRoutesMapLayout) {
      return balancedRoutesMapLayout.columns;
    }

    const tileColumns = tiles.map(tile => Math.min(this.getTilePersistedColumns(tile), maxColumns));
    if (tileColumns.every(columns => columns === 1)) {
      return this.getBalancedOneColumnSectionColumnCount(tiles.length, maxColumns);
    }

    const totalColumns = tileColumns.reduce((total, columns) => total + columns, 0);
    return Math.min(maxColumns, Math.max(1, totalColumns));
  }

  private getBalancedRoutesMapSectionLayout(
    tiles: DashboardTileViewModel[],
    maxColumns: number,
    sectionId: DashboardTileSectionId,
  ): SparseEqualWidthDashboardGridLayout | null {
    if (sectionId !== 'routesMaps') {
      return null;
    }

    return getSparseEqualWidthDashboardGridLayout(tiles.length, maxColumns);
  }

  private getBalancedOneColumnSectionColumnCount(tileCount: number, maxColumns: number): number {
    if (tileCount <= maxColumns) {
      return Math.max(1, tileCount);
    }

    const candidateColumns = Array.from(new Set([maxColumns, maxColumns - 1]))
      .filter(columns => columns > 1);
    return candidateColumns.reduce((bestColumns, columns) => {
      const bestScore = this.getOneColumnSectionLayoutScore(tileCount, bestColumns, maxColumns);
      const candidateScore = this.getOneColumnSectionLayoutScore(tileCount, columns, maxColumns);
      if (candidateScore < bestScore) {
        return columns;
      }

      if (candidateScore === bestScore && columns > bestColumns) {
        return columns;
      }

      return bestColumns;
    }, maxColumns);
  }

  private getOneColumnSectionLayoutScore(tileCount: number, columns: number, maxColumns: number): number {
    const rowCount = Math.ceil(tileCount / columns);
    const emptyCells = (rowCount * columns) - tileCount;
    const columnPenalty = maxColumns - columns;
    return (emptyCells * 4) + rowCount + columnPenalty;
  }

  private getTilePersistedColumns(tile: DashboardTileViewModel): number {
    const columns = Number(tile.size?.columns);
    if (!Number.isFinite(columns) || columns < 1) {
      return 1;
    }

    return Math.floor(columns);
  }

  private normalizeGridColumnCount(columns: number | string | null | undefined): number {
    const parsedColumns = Number(columns);
    if (!Number.isFinite(parsedColumns) || parsedColumns < 1) {
      return 1;
    }

    return Math.floor(parsedColumns);
  }

  private getFlattenedMainGridSectionTiles(): DashboardTileViewModel[] {
    return orderDashboardTilesByIntentSections(this.mainGridSections.flatMap(section => section.tiles))
      .filter(tile => !this.isKpiLaneTile(tile));
  }

  private getOrderedMainSettingsTilesBySection(tiles: TileSettingsInterface[]): TileSettingsInterface[] {
    return orderDashboardTilesByIntentSections(tiles).filter(tile => !this.isKpiSettingsTile(tile));
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
    const currentViewOrder = [...this.kpiLaneTiles, ...this.getFlattenedMainGridSectionTiles()].map(tile => tile.order);
    const currentSettingsOrder = [
      ...orderedSettingsTiles.filter(tile => this.isKpiSettingsTile(tile)).map(tile => tile.order),
      ...this.getOrderedMainSettingsTilesBySection(orderedSettingsTiles).map(tile => tile.order),
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
    const nextMainGridSettingsTiles = this.getFlattenedMainGridSectionTiles()
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
    const nextOrderByPreviousOrder = new Map<number, number>();
    nextSettingsTiles.forEach((tile, nextOrder) => nextOrderByPreviousOrder.set(tile.order, nextOrder));
    const previousOrderByNextOrder = new Map<number, number>();
    nextOrderByPreviousOrder.forEach((nextOrder, previousOrder) => previousOrderByNextOrder.set(nextOrder, previousOrder));

    dashboardSettings.tiles = this.withSequentialOrder(nextSettingsTiles);
    this.tiles = this.withSequentialOrder(this.cloneDashboardViewModels([...this.kpiLaneTiles, ...this.getFlattenedMainGridSectionTiles()]));
    this.refreshTileLanes();
    this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
    this.remapTileEventStateForOrderChange(nextOrderByPreviousOrder);
    this.loaded();
    this.changeDetector.markForCheck();

    try {
      await this.persistDashboardSettings({
        tiles: dashboardSettings.tiles,
      });
      this.updateDesktopTileDragCapability();
    } catch (error) {
      dashboardSettings.tiles = this.cloneTileSettings(previousSettingsTiles);
      this.tiles = this.withSequentialOrder(this.cloneDashboardViewModels(previousRenderedTilesByPersistedOrder));
      this.refreshTileLanes();
      this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
      this.remapTileEventStateForOrderChange(previousOrderByNextOrder);
      this.loaded();
      this.changeDetector.markForCheck();
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
    this.unsubscribeDashboardAutoTileSubscription();
    this.unsubscribeTileEventSubscriptions();
    this.unsubscribeRoutePreviewSubscription();
  }

  private unsubscribeTileEventSubscriptions(): void {
    this.tileEventSubscriptions.forEach(subscription => subscription.unsubscribe());
    this.tileEventSubscriptions.clear();
    this.tileEventSubscriptionStates.clear();
    this.tileEventListenerKeys.clear();
    this.tileEventAnchorEndMsByOrder.clear();
    this.tileEventsByOrder = {};
    this.tileEventLoadingByOrder = {};
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

  private getDashboardInputDependencySnapshot(user: User | null | undefined, eventUser: User | null | undefined): Record<string, unknown> {
    const appUser = user as AppUserInterface | null | undefined;
    const summariesSettings = appUser?.settings?.summariesSettings as {
      removeAscentForEventTypes?: unknown;
      removeDescentForEventTypes?: unknown;
    } | undefined;
    return {
      userUID: `${user?.uid || ''}`.trim(),
      eventUserUID: `${eventUser?.uid || user?.uid || ''}`.trim(),
      startOfTheWeek: appUser?.settings?.unitSettings?.startOfTheWeek ?? null,
      sleepTrendRange: normalizeDashboardSleepTrendRange(appUser?.settings?.dashboardSettings?.sleepTrend?.range),
      removeAscentForEventTypes: summariesSettings?.removeAscentForEventTypes ?? null,
      removeDescentForEventTypes: summariesSettings?.removeDescentForEventTypes ?? null,
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

  getFitnessCtlStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardFitnessCtlKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedFormStatus;
  }

  getFatigueAtlStatusForTile(tile: DashboardTileViewModel | TileSettingsInterface): DashboardDerivedMetricStatus | null {
    if (!isDashboardChartTileViewModel(tile)) {
      return null;
    }
    if (!isDashboardFatigueAtlKpiChartType(tile.chartType)) {
      return null;
    }
    return this.derivedFormStatus;
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
    if (isDashboardFitnessCtlKpiChartType(chartType) || isDashboardFatigueAtlKpiChartType(chartType)) {
      return this.derivedFormStatus;
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

}
