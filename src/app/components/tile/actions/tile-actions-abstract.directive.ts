import {
  TileSettingsInterface, TileTypes,
} from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import { AppUserService } from '../../../services/app.user.service';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { EventEmitter, Input, Output, Directive, inject } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';

@Directive()
export class TileActionsAbstractDirective extends TileAbstractDirective {
  protected analyticsService = inject(AppAnalyticsService);
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
    return this.withSavingState(() => this.userService.updateUserProperties(this.user, { settings: this.user.settings }));
  }

  async changeTileType(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileType' });
    const tileIndex = this.user.settings.dashboardSettings.tiles.findIndex(tile => tile.order === this.order);
    this.user.settings.dashboardSettings.tiles[tileIndex] = this.type === TileTypes.Map ? AppUserUtilities.getDefaultUserDashboardChartTile() : AppUserUtilities.getDefaultUserDashboardMapTile();
    this.user.settings.dashboardSettings.tiles[tileIndex].order = this.order;
    return this.persistUserSettings();
  }

  async changeTileColumnSize(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileSize' });
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.columns = event.value;
    return this.persistUserSettings();
  }

  async changeTileRowSize(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeTileSize' });
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.rows = event.value;
    return this.persistUserSettings();
  }

  async addNewTile($event: MouseEvent) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'addNewTile' });
    const chart = Object.assign({}, (<TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)));
    chart.order = this.user.settings.dashboardSettings.tiles.length;
    this.user.settings.dashboardSettings.tiles.push(chart);
    return this.persistUserSettings();
  }

  async deleteTile(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'deleteTile' });
    if (this.user.settings.dashboardSettings.tiles.length === 1) {
      throw new Error('Cannot delete tile there is only one left');
    }
    // should search and replace order index according to the remaining order indexes after the splice
    this.user.settings.dashboardSettings.tiles = this.user.settings.dashboardSettings.tiles
      .filter((chartSetting) => chartSetting.order !== this.order)
      .map((chartSetting, index) => {
        chartSetting.order = index;
        return chartSetting
      });
    return this.persistUserSettings();
  }

  canMoveTileBackward(): boolean {
    const orderedTiles = this.getOrderedTiles();
    const currentIndex = orderedTiles.findIndex(tile => tile.order === this.order);
    return currentIndex > 0;
  }

  canMoveTileForward(): boolean {
    const orderedTiles = this.getOrderedTiles();
    const currentIndex = orderedTiles.findIndex(tile => tile.order === this.order);
    return currentIndex >= 0 && currentIndex < orderedTiles.length - 1;
  }

  async moveTileBackward() {
    return this.moveTileByOffset(-1, 'moveTileBackward');
  }

  async moveTileForward() {
    return this.moveTileByOffset(1, 'moveTileForward');
  }

  private async moveTileByOffset(offset: number, analyticsMethod: 'moveTileBackward' | 'moveTileForward') {
    const orderedTiles = this.getOrderedTiles();
    const currentIndex = orderedTiles.findIndex(tile => tile.order === this.order);
    const targetIndex = currentIndex + offset;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedTiles.length) {
      return;
    }

    this.analyticsService.logEvent('dashboard_tile_action', { method: analyticsMethod });
    const currentTile = orderedTiles[currentIndex];
    orderedTiles[currentIndex] = orderedTiles[targetIndex];
    orderedTiles[targetIndex] = currentTile;
    orderedTiles.forEach((tile, index) => {
      tile.order = index;
    });

    this.user.settings.dashboardSettings.tiles = orderedTiles;
    this.order = targetIndex;
    return this.persistUserSettings();
  }

  private getOrderedTiles(): TileSettingsInterface[] {
    return [...(this.user?.settings?.dashboardSettings?.tiles || [])]
      .sort((left, right) => left.order - right.order);
  }

  /**
   * see https://github.com/angular/components/issues/11677
   */
  fixDisappearIOSBug() {
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
