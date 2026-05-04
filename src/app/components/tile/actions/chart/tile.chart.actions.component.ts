import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import {
  TileSettingsInterface,
  TileChartSettingsInterface,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';
import {
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  type DashboardChartType,
  isDashboardRecoveryNowChartType,
} from '../../../../helpers/dashboard-special-chart-types';
import {
  DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
  DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
  DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID,
  getDashboardAutoTileDescriptorForTile,
  isDashboardSleepTrendTile,
  markDashboardAutoTileDismissed,
} from '../../../../helpers/dashboard-auto-tile.helper';
import { AppDashboardAutoTileState, AppDashboardSettingsInterface } from '../../../../models/app-user.interface';

@Component({
  selector: 'app-tile-chart-actions',
  templateUrl: './tile.chart.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.chart.actions.component.css'],
  providers: [],
  standalone: false
})
export class TileChartActionsComponent extends TileActionsAbstractDirective implements OnInit {
  @Input() chartType: DashboardChartType;
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes;
  @Input() chartTimeInterval: TimeIntervals;
  @Input() chartOrder: number;
  @Output() editInDashboardManager = new EventEmitter<number>();

  constructor(
    userService: AppUserService) {
    super(userService);
  }

  override async deleteTile(event: unknown) {
    const dashboardTiles = this.user?.settings?.dashboardSettings?.tiles || [];
    if (dashboardTiles.length <= 1) {
      return super.deleteTile(event);
    }

    const dashboardSettings = this.user.settings.dashboardSettings as AppDashboardSettingsInterface;
    const previousTiles = this.cloneTiles(dashboardTiles);
    const previousDismissedRecoveryTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
    const previousAutoTiles = this.cloneAutoTiles(dashboardSettings.autoTiles || {});
    const tile = dashboardTiles.find(candidate => candidate.order === this.order);
    const chartType = (tile as TileChartSettingsInterface | null)?.chartType || this.chartType;
    const autoTileDescriptor = getDashboardAutoTileDescriptorForTile(tile);
    if (isDashboardRecoveryNowChartType(chartType) || autoTileDescriptor?.id === DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID) {
      dashboardSettings.dismissedCuratedRecoveryNowTile = true;
    }
    if (autoTileDescriptor || isDashboardSleepTrendTile(tile) || `${chartType}` === DASHBOARD_SLEEP_TREND_CHART_TYPE) {
      markDashboardAutoTileDismissed(
        dashboardSettings,
        autoTileDescriptor?.id || DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
        autoTileDescriptor?.source || DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
        Date.now(),
      );
    }
    try {
      return await super.deleteTile(event);
    } catch (error) {
      dashboardSettings.tiles = previousTiles;
      dashboardSettings.dismissedCuratedRecoveryNowTile = previousDismissedRecoveryTile;
      dashboardSettings.autoTiles = previousAutoTiles as AppDashboardSettingsInterface['autoTiles'];
      throw error;
    }
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }

  openEditInDashboardManager(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.hapticsService.selection();
    this.editInDashboardManager.emit(this.order);
  }

  private cloneTiles(tiles: TileSettingsInterface[]): TileSettingsInterface[] {
    return (tiles || []).map(tile => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size,
    } as TileSettingsInterface));
  }

  private cloneAutoTiles(
    autoTiles: Partial<Record<string, AppDashboardAutoTileState>>,
  ): Partial<Record<string, AppDashboardAutoTileState>> {
    return Object.entries(autoTiles).reduce<Partial<Record<string, AppDashboardAutoTileState>>>((cloned, [id, state]) => {
      if (state) {
        cloned[id] = { ...state };
      }
      return cloned;
    }, {});
  }
}
