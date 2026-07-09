import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
} from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import { AppUserService } from '../../../services/app.user.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { EventEmitter, Input, Output, Directive, inject } from '@angular/core';
import { AppHapticsService } from '../../../services/app.haptics.service';
import {
  AppDashboardChartTileSettingsInterface,
  AppDashboardSettingsInterface,
} from '../../../models/app-user.interface';
import {
  type DashboardTileLaneKey,
  orderDashboardTilesByIntentSections,
  resolveDashboardTileLaneKey,
} from '../../../helpers/dashboard-tile-section.helper';
import {
  DASHBOARD_KPI_GROUP_DEFINITIONS,
  isDashboardKpiGroup,
  resolveDashboardKpiTileGroup,
} from '../../../helpers/dashboard-kpi-group.helper';
import type { DashboardKpiGroup } from '../../../helpers/dashboard-special-chart-types';

@Directive()
export class TileActionsAbstractDirective extends TileAbstractDirective {
  protected analyticsService = inject(AppAnalyticsService);
  protected hapticsService = inject(AppHapticsService);
  public readonly kpiMoveGroupOptions = DASHBOARD_KPI_GROUP_DEFINITIONS;
  @Input() showLayoutControls = true;
  @Output() savingChange = new EventEmitter<boolean>();

  constructor(protected userService: AppUserService) {
    super();
  }

  protected async withSavingState<T>(operation: () => Promise<T>): Promise<T> {
    this.savingChange.emit(true);
    try {
      return await operation();
    } finally {
      this.savingChange.emit(false);
    }
  }

  protected async persistUserSettings(): Promise<unknown> {
    const dashboardSettingsPatch = this.buildDashboardSettingsPersistencePatch();
    if (Object.keys(dashboardSettingsPatch).length === 0) {
      return this.withSavingState(() => Promise.resolve());
    }

    return this.withSavingState(() => this.userService.updateUserProperties(this.user, {
      settings: {
        dashboardSettings: dashboardSettingsPatch,
      },
    }));
  }

  protected buildDashboardSettingsPersistencePatch(): Partial<AppDashboardSettingsInterface> {
    const dashboardSettings = this.user?.settings?.dashboardSettings as AppDashboardSettingsInterface | undefined;
    if (!dashboardSettings) {
      return {};
    }

    return {
      tiles: dashboardSettings.tiles || [],
    };
  }

  async changeTileType(_event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileType' });
    const tileIndex = this.user.settings.dashboardSettings.tiles.findIndex(tile => tile.order === this.order);
    this.user.settings.dashboardSettings.tiles[tileIndex] = this.type === TileTypes.Map ? AppUserUtilities.getDefaultUserDashboardChartTile() : AppUserUtilities.getDefaultUserDashboardMapTile();
    this.user.settings.dashboardSettings.tiles[tileIndex].order = this.order;
    return this.persistUserSettings();
  }

  async changeTileColumnSize(event) {
    if (!this.showLayoutControls) {
      return;
    }
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileSize' });
    this.hapticsService.selection();
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.columns = event.value;
    return this.persistUserSettings();
  }

  async changeTileRowSize(event) {
    if (!this.showLayoutControls) {
      return;
    }
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileSize' });
    this.hapticsService.selection();
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.rows = event.value;
    return this.persistUserSettings();
  }

  async addNewTile(_event: MouseEvent) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'addNewTile' });
    const chart = Object.assign({}, (<TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)));
    chart.order = this.user.settings.dashboardSettings.tiles.length;
    this.user.settings.dashboardSettings.tiles.push(chart);
    return this.persistUserSettings();
  }

  async deleteTile(_event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'deleteTile' });
    this.hapticsService.selection();
    if (this.user.settings.dashboardSettings.tiles.length === 1) {
      throw new Error('Cannot delete tile there is only one left');
    }
    const remainingTiles = this.getOrderedTiles().filter((chartSetting) => chartSetting.order !== this.order);
    this.user.settings.dashboardSettings.tiles = orderDashboardTilesByIntentSections(remainingTiles)
      .map((chartSetting, index) => ({ ...chartSetting, order: index }));
    return this.persistUserSettings();
  }

  canMoveTileBackward(): boolean {
    const orderedTiles = this.getOrderedTiles();
    const orderedLaneTiles = this.getOrderedLaneTiles(orderedTiles);
    const currentIndex = orderedLaneTiles.findIndex(tile => tile.order === this.order);
    return currentIndex > 0;
  }

  canMoveTileForward(): boolean {
    const orderedTiles = this.getOrderedTiles();
    const orderedLaneTiles = this.getOrderedLaneTiles(orderedTiles);
    const currentIndex = orderedLaneTiles.findIndex(tile => tile.order === this.order);
    return currentIndex >= 0 && currentIndex < orderedLaneTiles.length - 1;
  }

  async moveTileBackward() {
    this.hapticsService.selection();
    return this.moveTileByOffset(-1, 'moveTileBackward');
  }

  async moveTileForward() {
    this.hapticsService.selection();
    return this.moveTileByOffset(1, 'moveTileForward');
  }

  public isCurrentTileKpi(): boolean {
    return !!this.getCurrentKpiTile();
  }

  public getCurrentKpiGroup(): DashboardKpiGroup | null {
    return this.getCurrentKpiTile()?.group || null;
  }

  public canMoveTileToKpiGroup(groupId: DashboardKpiGroup): boolean {
    if (!isDashboardKpiGroup(groupId)) {
      return false;
    }

    const currentTile = this.getCurrentKpiTile();
    return !!currentTile && currentTile.group !== groupId;
  }

  public async moveTileToKpiGroup(groupId: DashboardKpiGroup): Promise<void> {
    if (!this.canMoveTileToKpiGroup(groupId)) {
      return;
    }

    const orderedTiles = this.getOrderedTiles();
    const currentTile = this.getCurrentKpiTile(orderedTiles);
    if (!currentTile) {
      return;
    }

    this.analyticsService.logEvent('dashboard_tile_action', {
      method: 'moveTileToKpiGroup',
      group: groupId,
    });
    this.hapticsService.selection();

    const updatedCurrentTile = {
      ...currentTile.tile,
      kpiGroup: groupId,
    } as AppDashboardChartTileSettingsInterface as TileSettingsInterface;
    const otherTiles = orderedTiles.filter(tile => tile.order !== this.order);
    const nextOrderedTiles = orderDashboardTilesByIntentSections([
      ...otherTiles,
      updatedCurrentTile,
    ]);
    nextOrderedTiles.forEach((tile, index) => {
      tile.order = index;
    });

    this.user.settings.dashboardSettings.tiles = nextOrderedTiles;
    this.order = updatedCurrentTile.order;
    await this.persistUserSettings();
  }

  private async moveTileByOffset(offset: number, analyticsMethod: 'moveTileBackward' | 'moveTileForward') {
    const orderedTiles = this.getOrderedTiles();
    const orderedLaneTiles = this.getOrderedLaneTiles(orderedTiles);
    const currentIndex = orderedLaneTiles.findIndex(tile => tile.order === this.order);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedLaneTiles.length) {
      return;
    }

    this.analyticsService.logEvent('dashboard_tile_action', { method: analyticsMethod });
    const currentTile = orderedLaneTiles[currentIndex];
    orderedLaneTiles[currentIndex] = orderedLaneTiles[targetIndex];
    orderedLaneTiles[targetIndex] = currentTile;
    const nextOrderedTiles = this.flattenTilesWithUpdatedLane(
      orderedTiles,
      this.getTileActionLaneKey(currentTile),
      orderedLaneTiles,
    );
    nextOrderedTiles.forEach((tile, index) => {
      tile.order = index;
    });

    this.user.settings.dashboardSettings.tiles = nextOrderedTiles;
    this.order = currentTile.order;
    return this.persistUserSettings();
  }

  private getOrderedTiles(): TileSettingsInterface[] {
    return [...(this.user?.settings?.dashboardSettings?.tiles || [])]
      .sort((left, right) => left.order - right.order);
  }

  private getOrderedLaneTiles(orderedTiles: TileSettingsInterface[]): TileSettingsInterface[] {
    const currentTile = orderedTiles.find(tile => tile.order === this.order);
    if (!currentTile) {
      return [];
    }

    const laneKey = this.getTileActionLaneKey(currentTile);
    return orderedTiles.filter(tile => this.getTileActionLaneKey(tile) === laneKey);
  }

  private flattenTilesWithUpdatedLane(
    orderedTiles: TileSettingsInterface[],
    updatedLaneKey: DashboardTileLaneKey,
    updatedLaneTiles: TileSettingsInterface[],
  ): TileSettingsInterface[] {
    let updatedLaneIndex = 0;
    return orderDashboardTilesByIntentSections(orderedTiles.map((tile) => {
      if (this.getTileActionLaneKey(tile) !== updatedLaneKey) {
        return tile;
      }

      const updatedTile = updatedLaneTiles[updatedLaneIndex];
      updatedLaneIndex += 1;
      return updatedTile || tile;
    }));
  }

  private getTileActionLaneKey(tile: TileSettingsInterface): DashboardTileLaneKey {
    return resolveDashboardTileLaneKey(tile);
  }

  private getCurrentKpiTile(
    orderedTiles: TileSettingsInterface[] = this.getOrderedTiles(),
  ): { tile: TileChartSettingsInterface; group: DashboardKpiGroup } | null {
    const currentTile = orderedTiles.find(tile => tile.order === this.order);
    const currentGroup = resolveDashboardKpiTileGroup(currentTile);
    if (!currentGroup || currentTile?.type !== TileTypes.Chart) {
      return null;
    }

    return {
      tile: currentTile as TileChartSettingsInterface,
      group: currentGroup,
    };
  }

  /**
   * see https://github.com/angular/components/issues/11677
   */
  fixDisappearIOSBug() {
    this.hapticsService.selection();
    document.getElementById('panel-fix')?.remove();
    const styleNode = document.createElement('style');
    styleNode.type = 'text/css';
    styleNode.id = 'panel-fix';
    styleNode.appendChild(
      document.createTextNode('.mat-mdc-menu-panel,.mat-menu-panel{overflow: visible !important;}')
    );
    document.getElementsByTagName('head')[0].appendChild(styleNode);
    setTimeout(() => {
      styleNode.remove();
    }, 500);
  }
}
