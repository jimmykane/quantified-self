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
import { Subscription } from 'rxjs';
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

  public rowHeight;
  public numberOfCols: number;


  public tiles: DashboardTileViewModel[] = [];

  public tileTypes = TileTypes;
  public desktopTileDragEnabled = false;


  private appThemeSubscription: Subscription;
  public darkTheme = false;
  private logger: LoggerService;
  private dashboardTileSettingsSnapshot: TileSettingsInterface[] = [];

  constructor(
    private themeService: AppThemeService,
    private userService: AppUserService,
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
    if (simpleChanges.events || simpleChanges.user) {
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

  private async unsubscribeAndCreateCharts() {
    const buildStart = performance.now();
    this.unsubscribeFromAll();
    this.appThemeSubscription = this.themeService.getAppTheme().subscribe((theme) => {
      this.darkTheme = theme === AppThemes.Dark;
    });

    const newTiles = buildDashboardTileViewModels({
      tiles: this.user?.settings?.dashboardSettings?.tiles ?? [],
      events: this.events,
      preferences: this.getAggregationPreferences(),
      logger: this.logger,
    });
    this.dashboardTileSettingsSnapshot = this.getDashboardTileSettingsSnapshot();
    this.logger.log('[perf] summaries_build_tiles', {
      durationMs: Number((performance.now() - buildStart).toFixed(2)),
      inputEvents: this.events?.length || 0,
      generatedTiles: newTiles.length,
    });
    // if there are no current charts get and assign and get done
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

    // Here we need to update:
    // 1. Go over the new ones
    // 2. If there is a current one and differs update it
    // 3. If not leave it alone so no change detection is triggered to the children
    newTiles.forEach(newChart => {
      // Find one with the same order
      const sameOrderChart = this.tiles.find(chart => chart.order === newChart.order);
      // If none of the same order then its new so only push
      if (!sameOrderChart) {
        this.tiles.push(newChart);
        return;
      }
      // If we found one with the same order then compare for changes
      // if its equal then noop / no equal replace the current index
      if (!equal(sameOrderChart, newChart)) {
        this.tiles[this.tiles.findIndex(chart => chart === sameOrderChart)] = newChart;
      }
    });
    // Here we need to remove non existing ones
    this.tiles = this.tiles.filter(chart => newTiles.find(newChart => newChart.order === chart.order));
    this.updateDesktopTileDragCapability();
    this.loaded();
    this.logger.log('[perf] summaries_commit_tiles', {
      durationMs: Number((performance.now() - buildStart).toFixed(2)),
      finalTiles: this.tiles.length,
    });
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
    if (this.appThemeSubscription) {
    this.appThemeSubscription.unsubscribe();
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
}
