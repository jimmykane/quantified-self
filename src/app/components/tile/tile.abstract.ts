import {Input} from '@angular/core';
import {
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { User } from '@sports-alliance/sports-lib/lib/users/user';
import { UserService } from '../../services/app.user.service';
import { AngularFireAnalytics } from "@angular/fire/analytics";

export class TileAbstract {
  @Input() isLoading: boolean;
  @Input() user: User;
  @Input() order: number;

  public tileTypes = TileTypes;

  constructor(protected userService: UserService, protected afa: AngularFireAnalytics) {
  }

  async changeTileType(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeTileType'});
    debugger
    (<TileSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).type = event.value;
    // If its pie show only totals
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }
}

