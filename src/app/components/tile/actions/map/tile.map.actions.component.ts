import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib';
import { TileMapSettingsInterface } from '@sports-alliance/sports-lib';
import { logEvent } from '@angular/fire/analytics';

@Component({
  selector: 'app-tile-map-actions',
  templateUrl: './tile.map.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.map.actions.component.css'],
  providers: [],
  standalone: false
})
export class TileMapActionsComponent extends TileActionsAbstractDirective implements OnInit, OnChanges {
  @Input() mapType: MapTypes;
  @Input() mapTheme: MapThemes;
  @Input() showHeatMap: boolean;
  @Input() clusterMarkers: boolean;

  public mapTypes = MapTypes;
  public mapThemes = MapThemes;
  public iconColor: string;

  constructor(
    userService: AppUserService) {
    super(userService);
  }


  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    switch (this.mapTheme) {
      case MapThemes.Desert:
      case MapThemes.Dark:
      case MapThemes.Black:
      case MapThemes.MidnightCommander:
      case MapThemes.Night:
      case MapThemes.DarkElectric:
        this.iconColor = '#FFFFFF';
        break;
      default:
        this.iconColor = '#000000'
        break;
    }
  }

  async changeMapType(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'changeMapType' });
    (<TileMapSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).mapType = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  async changeMapTheme(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'changeMapTheme' });
    (<TileMapSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).mapTheme = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  async switchHeatMap(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'switchHeatmap' });
    (<TileMapSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).showHeatMap = this.showHeatMap;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  async switchClusterMarkers(event) {
    logEvent(this.analytics, 'dashboard_tile_action', { method: 'switchClusterMarkers' });
    (<TileMapSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).clusterMarkers = this.clusterMarkers;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

}



