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
