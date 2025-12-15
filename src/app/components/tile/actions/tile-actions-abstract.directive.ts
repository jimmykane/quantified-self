import {
  TileSettingsInterface, TileTypes,
} from '@sports-alliance/sports-lib';
import { TileAbstractDirective } from '../tile-abstract.directive';
import { AppUserService } from '../../../services/app.user.service';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { Input, Directive, inject } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';

@Directive()
export class TileActionsAbstractDirective extends TileAbstractDirective {
  protected analytics = inject(Analytics);

  constructor(protected userService: AppUserService) {
    super();
  }

  async changeTileType(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'changeTileType' });
    const tileIndex = this.user.settings.dashboardSettings.tiles.findIndex(tile => tile.order === this.order);
    this.user.settings.dashboardSettings.tiles[tileIndex] = this.type === TileTypes.Map ? AppUserService.getDefaultUserDashboardChartTile() : AppUserService.getDefaultUserDashboardMapTile();
    this.user.settings.dashboardSettings.tiles[tileIndex].order = this.order;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  async changeTileColumnSize(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'changeTileSize' });
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.columns = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  async changeTileRowSize(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'changeTileSize' });
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tileToFind => tileToFind.order === this.order);
    tile.size.rows = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  async addNewTile($event: MouseEvent) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'addNewTile' });
    const chart = Object.assign({}, (<TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)));
    chart.order = this.user.settings.dashboardSettings.tiles.length;
    this.user.settings.dashboardSettings.tiles.push(chart);
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  async deleteTile(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'deleteTile' });
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
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  /**
   * see https://github.com/angular/components/issues/11677
   */
  fixDisappearIOSBug() {
    const styleNode = document.createElement('style');
    styleNode.type = 'text/css';
    styleNode.id = 'panel-fix';
    styleNode.appendChild(document.createTextNode('.mat-menu-panel{overflow: initial !important;}'));
    document.getElementsByTagName('head')[0].appendChild(styleNode);
    setTimeout(() => {
      styleNode.remove();
    }, 500);
  }
}

