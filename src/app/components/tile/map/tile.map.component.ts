import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import { TileAbstract } from '../tile.abstract';
import { EventInterface } from '@sports-alliance/sports-lib/lib/events/event.interface';
import { TileMapSettingsInterface } from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';

@Component({
  selector: 'app-tile-map',
  templateUrl: './tile.map.component.html',
  styleUrls: ['../tile.abstract.css', './tile.map.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class TileMapComponent extends TileAbstract {
  @Input() mapType: MapTypes;
  @Input() mapTheme: MapThemes;
  @Input() showHeatMap: boolean;
  @Input() clusterMarkers: boolean;
  @Input() events: EventInterface[] = [];

  public mapTypes = MapTypes;
  public mapThemes = MapThemes;


  async changeMapType(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeMapType'});
    (<TileMapSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).mapType = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }
  async changeMapTheme(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeMapTheme'});
    (<TileMapSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).mapTheme = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }
}
