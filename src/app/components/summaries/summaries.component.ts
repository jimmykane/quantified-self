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

@Component({
  selector: 'app-summaries',
  templateUrl: './summaries.component.html',
  styleUrls: ['./summaries.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class SummariesComponent extends LoadingAbstractDirective implements OnInit, OnDestroy, OnChanges, DoCheck {
  @Input() events: EventInterface[];
  @Input() user: User;
  @Input() showActions: boolean;

  public rowHeight;
  public numberOfCols: number;


  public tiles: DashboardTileViewModel[] = [];

  public tileTypes = TileTypes;


  private appThemeSubscription: Subscription;
  public darkTheme = false;
  private logger: LoggerService;
  private dashboardTileSettingsSnapshot: TileSettingsInterface[] = [];

  constructor(
    private themeService: AppThemeService,
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
  }

  ngOnInit() {
  }

  async ngOnChanges(simpleChanges: SimpleChanges) {
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
