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
import type { DashboardFormPoint } from '../../helpers/dashboard-form.helper';
import type { DashboardRecoveryNowContext } from '../../helpers/dashboard-recovery-now.helper';
import type {
  DashboardAcwrContext,
  DashboardEfficiencyTrendContext,
  DashboardFreshnessForecastContext,
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
  isDashboardEfficiencyTrendChartType,
  isDashboardFreshnessForecastChartType,
  isDashboardFormChartType,
  isDashboardIntensityDistributionChartType,
  isDashboardMonotonyStrainKpiChartType,
  isDashboardRampRateKpiChartType,
  isDashboardRecoveryNowChartType,
} from '../../helpers/dashboard-special-chart-types';
import { MatDialog } from '@angular/material/dialog';
import { DashboardManagerDialogComponent } from './dashboard-manager-dialog/dashboard-manager-dialog.component';

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

  @Input() events: EventInterface[];
  @Input() user: User;
  @Input() showActions: boolean;
  @Input() dashboardDateRange: DateRanges | null = null;
  @Input() dashboardStartDate: Date | number | null = null;
  @Input() dashboardEndDate: Date | number | null = null;

  public rowHeight;
  public numberOfCols: number;


  public tiles: DashboardTileViewModel[] = [];

  public tileTypes = TileTypes;
  public desktopTileDragEnabled = false;
  public isDashboardManagerOpen = false;


  private appThemeSubscription: Subscription | null = null;
  private derivedMetricsSubscription: Subscription | null = null;
  private derivedMetricsUserUID: string | null = null;
  public darkTheme = false;
  private logger: LoggerService;
  private dashboardTileSettingsSnapshot: TileSettingsInterface[] = [];
  private derivedFormPoints: DashboardFormPoint[] | null = null;
  private derivedRecoveryNowContext: DashboardRecoveryNowContext | null = null;
  private derivedAcwrContext: DashboardAcwrContext | null = null;
  private derivedRampRateContext: DashboardRampRateContext | null = null;
  private derivedMonotonyStrainContext: DashboardMonotonyStrainContext | null = null;
  private derivedFreshnessForecastContext: DashboardFreshnessForecastContext | null = null;
  private derivedIntensityDistributionContext: DashboardIntensityDistributionContext | null = null;
  private derivedEfficiencyTrendContext: DashboardEfficiencyTrendContext | null = null;
  private derivedFormStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedRecoveryNowStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedAcwrStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedRampRateStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedMonotonyStrainStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedFreshnessForecastStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedIntensityDistributionStatus: DashboardDerivedMetricStatus = 'missing';
  private derivedEfficiencyTrendStatus: DashboardDerivedMetricStatus = 'missing';
  public derivedMetricsBanner: DashboardDerivedMetricsBanner | null = null;

  constructor(
    private themeService: AppThemeService,
    private userService: AppUserService,
    private dashboardDerivedMetricsService: DashboardDerivedMetricsService,
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
    const currentViewOrder = this.tiles.map(tile => tile.order);
    const currentSettingsOrder = orderedSettingsTiles.map(tile => tile.order);
    if (this.getOrderSignature(currentViewOrder) === this.getOrderSignature(currentSettingsOrder)) {
      return;
    }

    const settingsByOrder = new Map<number, TileSettingsInterface>(
      orderedSettingsTiles.map(tile => [tile.order, tile])
    );
    const nextSettingsTiles = currentViewOrder
      .map(order => settingsByOrder.get(order))
      .filter((tile): tile is TileSettingsInterface => !!tile);
    if (nextSettingsTiles.length !== orderedSettingsTiles.length) {
      this.logger.warn('[SummariesComponent] Skipping dashboard tile drag persist because order mapping was incomplete.');
      return;
    }

    const previousSettingsTiles = this.cloneTileSettings(dashboardSettings.tiles);
    const previousRenderedTiles = this.cloneDashboardViewModels(this.tiles);
    const previousRenderedTilesByPersistedOrder = [...previousRenderedTiles]
      .sort((left, right) => left.order - right.order);
    dashboardSettings.tiles = this.withSequentialOrder(nextSettingsTiles);
    this.tiles = this.withSequentialOrder([...this.tiles]);
    this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();

    try {
      await this.userService.updateUserProperties(this.user as any, { settings: this.user?.settings });
      this.updateDesktopTileDragCapability();
    } catch (error) {
      dashboardSettings.tiles = this.cloneTileSettings(previousSettingsTiles);
      this.tiles = this.withSequentialOrder(this.cloneDashboardViewModels(previousRenderedTilesByPersistedOrder));
      this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
      this.updateDesktopTileDragCapability();
      this.logger.error('[SummariesComponent] Failed to persist dashboard tile drag order update', error);
    }
  }

  public onTilesSort(event: CdkDragSortEvent<DashboardTileViewModel[]>): void {
    if (!this.desktopTileDragEnabled || !this.showActions || this.tiles.length < 2 || event.previousIndex === event.currentIndex) {
      return;
    }
    moveItemInArray(this.tiles, event.previousIndex, event.currentIndex);
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
      this.darkTheme = theme === AppThemes.Dark;
    });
    this.syncDerivedMetricsSubscription();
    await this.rebuildTilesFromCurrentState();
  }

  private async rebuildTilesFromCurrentState(): Promise<void> {
    const buildStart = performance.now();
    this.logRecoveryPipelineState('before_tile_build');
    this.refreshDerivedMetricsBannerState();
    const newTiles = buildDashboardTileViewModels({
      tiles: this.user?.settings?.dashboardSettings?.tiles ?? [],
      events: this.events,
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
      this.derivedFormPoints = null;
      this.derivedRecoveryNowContext = null;
      this.derivedAcwrContext = null;
      this.derivedRampRateContext = null;
      this.derivedMonotonyStrainContext = null;
      this.derivedFreshnessForecastContext = null;
      this.derivedIntensityDistributionContext = null;
      this.derivedEfficiencyTrendContext = null;
      this.derivedFormStatus = 'missing';
      this.derivedRecoveryNowStatus = 'missing';
      this.derivedAcwrStatus = 'missing';
      this.derivedRampRateStatus = 'missing';
      this.derivedMonotonyStrainStatus = 'missing';
      this.derivedFreshnessForecastStatus = 'missing';
      this.derivedIntensityDistributionStatus = 'missing';
      this.derivedEfficiencyTrendStatus = 'missing';
      this.refreshDerivedMetricsBannerState();
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
    this.derivedFormPoints = null;
    this.derivedRecoveryNowContext = null;
    this.derivedAcwrContext = null;
    this.derivedRampRateContext = null;
    this.derivedMonotonyStrainContext = null;
    this.derivedFreshnessForecastContext = null;
    this.derivedIntensityDistributionContext = null;
    this.derivedEfficiencyTrendContext = null;
    this.derivedFormStatus = 'missing';
    this.derivedRecoveryNowStatus = 'missing';
    this.derivedAcwrStatus = 'missing';
    this.derivedRampRateStatus = 'missing';
    this.derivedMonotonyStrainStatus = 'missing';
    this.derivedFreshnessForecastStatus = 'missing';
    this.derivedIntensityDistributionStatus = 'missing';
    this.derivedEfficiencyTrendStatus = 'missing';
    this.refreshDerivedMetricsBannerState();

    this.derivedMetricsSubscription = this.dashboardDerivedMetricsService.watch(this.user).subscribe((state) => {
      this.dashboardDerivedMetricsService.ensureForDashboard(this.user, state);

      const hasFormPointsChanged = !equal(this.derivedFormPoints, state.formPoints);
      const hasRecoveryContextChanged = !equal(this.derivedRecoveryNowContext, state.recoveryNow);
      const hasAcwrChanged = !equal(this.derivedAcwrContext, state.acwr);
      const hasRampRateChanged = !equal(this.derivedRampRateContext, state.rampRate);
      const hasMonotonyStrainChanged = !equal(this.derivedMonotonyStrainContext, state.monotonyStrain);
      const hasFreshnessForecastChanged = !equal(this.derivedFreshnessForecastContext, state.freshnessForecast);
      const hasIntensityDistributionChanged = !equal(this.derivedIntensityDistributionContext, state.intensityDistribution);
      const hasEfficiencyTrendChanged = !equal(this.derivedEfficiencyTrendContext, state.efficiencyTrend);
      const hasFormStatusChanged = this.derivedFormStatus !== state.formStatus;
      const hasRecoveryStatusChanged = this.derivedRecoveryNowStatus !== state.recoveryNowStatus;
      const hasAcwrStatusChanged = this.derivedAcwrStatus !== state.acwrStatus;
      const hasRampRateStatusChanged = this.derivedRampRateStatus !== state.rampRateStatus;
      const hasMonotonyStrainStatusChanged = this.derivedMonotonyStrainStatus !== state.monotonyStrainStatus;
      const hasFreshnessForecastStatusChanged = this.derivedFreshnessForecastStatus !== state.freshnessForecastStatus;
      const hasIntensityDistributionStatusChanged = this.derivedIntensityDistributionStatus !== state.intensityDistributionStatus;
      const hasEfficiencyTrendStatusChanged = this.derivedEfficiencyTrendStatus !== state.efficiencyTrendStatus;
      const hasBannerStateChanged = hasFormStatusChanged
        || hasRecoveryStatusChanged
        || hasAcwrStatusChanged
        || hasRampRateStatusChanged
        || hasMonotonyStrainStatusChanged
        || hasFreshnessForecastStatusChanged
        || hasIntensityDistributionStatusChanged
        || hasEfficiencyTrendStatusChanged;
      const hasTileDataChanged = hasFormPointsChanged
        || hasRecoveryContextChanged
        || hasAcwrChanged
        || hasRampRateChanged
        || hasMonotonyStrainChanged
        || hasFreshnessForecastChanged
        || hasIntensityDistributionChanged
        || hasEfficiencyTrendChanged;
      if (!hasTileDataChanged && !hasBannerStateChanged) {
        return;
      }

      this.derivedFormPoints = state.formPoints;
      this.derivedRecoveryNowContext = state.recoveryNow;
      this.derivedAcwrContext = state.acwr;
      this.derivedRampRateContext = state.rampRate;
      this.derivedMonotonyStrainContext = state.monotonyStrain;
      this.derivedFreshnessForecastContext = state.freshnessForecast;
      this.derivedIntensityDistributionContext = state.intensityDistribution;
      this.derivedEfficiencyTrendContext = state.efficiencyTrend;
      this.derivedFormStatus = state.formStatus;
      this.derivedRecoveryNowStatus = state.recoveryNowStatus;
      this.derivedAcwrStatus = state.acwrStatus;
      this.derivedRampRateStatus = state.rampRateStatus;
      this.derivedMonotonyStrainStatus = state.monotonyStrainStatus;
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
    this.desktopTileDragEnabled = this.showActions === true
      && this.tiles.length > 1
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

  private getOrderSignature(orders: number[]): string {
    return orders.join(',');
  }

  private unsubscribeFromAll() {
    this.unsubscribeThemeSubscription();
    if (this.derivedMetricsSubscription) {
      this.derivedMetricsSubscription.unsubscribe();
      this.derivedMetricsSubscription = null;
      this.derivedMetricsUserUID = null;
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
      freshnessForecast: this.derivedFreshnessForecastContext,
      intensityDistribution: this.derivedIntensityDistributionContext,
      efficiencyTrend: this.derivedEfficiencyTrendContext,
      formStatus: this.derivedFormStatus,
      recoveryNowStatus: this.derivedRecoveryNowStatus,
      acwrStatus: this.derivedAcwrStatus,
      rampRateStatus: this.derivedRampRateStatus,
      monotonyStrainStatus: this.derivedMonotonyStrainStatus,
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
      this.derivedMetricsBanner = null;
      return;
    }

    if (relevantStatuses.some(status => status === 'failed')) {
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
      this.derivedMetricsBanner = {
        type: 'pending',
        title: isUsingStaleData ? 'Refreshing training metrics' : 'Building training metrics',
        description: isUsingStaleData
          ? 'Using stale derived metrics while a refresh is in progress.'
          : 'Derived dashboard metrics are being prepared in the background.',
        showRetry: false,
      };
      return;
    }

    this.derivedMetricsBanner = null;
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
