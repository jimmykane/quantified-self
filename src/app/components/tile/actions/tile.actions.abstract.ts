import {
  TileSettingsInterface, TileTypes,
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { TileAbstract } from '../tile.abstract';
import { UserService } from '../../../services/app.user.service';
import { AngularFireAnalytics } from '@angular/fire/analytics';
import { Input } from '@angular/core';
import { User } from '@sports-alliance/sports-lib/lib/users/user';

export class TileActionsAbstract extends TileAbstract {
  @Input() isLoading: boolean;
  @Input() user: User;
  @Input() order: number;
  @Input() type:  TileTypes;
  @Input() size:  { columns: number, rows: number };

  constructor(protected userService: UserService, protected afa: AngularFireAnalytics) {
    super();
  }

  async changeTileType(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeTileType'});
    const tileIndex = this.user.settings.dashboardSettings.tiles.findIndex(tile => tile.order === this.order);
    this.user.settings.dashboardSettings.tiles[tileIndex] = this.type === TileTypes.Map ? UserService.getDefaultUserDashboardChartTile() : UserService.getDefaultUserDashboardMapTile();
    this.user.settings.dashboardSettings.tiles[tileIndex].order = this.order;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeTileColumnSize(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeTileSize'});
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order);
    tile.size.columns = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeTileRowSize(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeTileSize'});
    const tile = <TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order);
    tile.size.rows = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async addNewTile($event: MouseEvent) {
    this.afa.logEvent('dashboard_tile_action', {method: 'addNewTile'});
    const chart = Object.assign({}, (<TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)));
    chart.order = this.user.settings.dashboardSettings.tiles.length;
    this.user.settings.dashboardSettings.tiles.push(chart);
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async deleteTile(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'deleteTile'});
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
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }
}

