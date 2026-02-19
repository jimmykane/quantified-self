import { Component, Input, OnInit, inject } from '@angular/core';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';
import { TileMapSettingsInterface } from '@sports-alliance/sports-lib';
import { MapStyleService } from '../../../../services/map-style.service';
import { MapStyleName } from '../../../../services/map/map-style.types';

type DashboardMapTileSettings = TileMapSettingsInterface & { mapStyle?: MapStyleName };

@Component({
  selector: 'app-tile-map-actions',
  templateUrl: './tile.map.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.map.actions.component.css'],
  providers: [],
  standalone: false
})
export class TileMapActionsComponent extends TileActionsAbstractDirective implements OnInit {
  @Input() mapStyle: MapStyleName = 'default';
  @Input() clusterMarkers!: boolean;
  public iconColor: string = '';
  private mapStyleService = inject(MapStyleService);

  public get mapStyleOptions() {
    return this.mapStyleService.getSupportedStyleOptions();
  }

  constructor(
    userService: AppUserService) {
    super(userService);
  }


  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }

  async changeMapStyle(event: any) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeMapStyle' });
    const tile = <DashboardMapTileSettings>this.user?.settings.dashboardSettings.tiles.find(tile => tile.order === this.order);
    if (tile) {
      tile.mapStyle = this.mapStyleService.normalizeStyle(event.value);
      delete (tile as any).mapType;
    }
    return this.userService.updateUserProperties(this.user!, { settings: this.user!.settings })
  }



  async switchClusterMarkers(event: any) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'switchClusterMarkers' });
    const tile = <TileMapSettingsInterface>this.user?.settings.dashboardSettings.tiles.find(tile => tile.order === this.order);
    if (tile) {
      tile.clusterMarkers = this.clusterMarkers;
    }
    return this.userService.updateUserProperties(this.user!, { settings: this.user!.settings })
  }

}


