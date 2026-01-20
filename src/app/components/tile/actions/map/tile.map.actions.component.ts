import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { AppUserService } from '../../../../services/app.user.service';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib';
import { TileMapSettingsInterface } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-tile-map-actions',
  templateUrl: './tile.map.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.map.actions.component.css'],
  providers: [],
  standalone: false
})
export class TileMapActionsComponent extends TileActionsAbstractDirective implements OnInit, OnChanges {
  @Input() mapType!: MapTypes;
  @Input() clusterMarkers!: boolean;

  public mapTypes = MapTypes;
  public iconColor: string = '';

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
  }

  async changeMapType(event: any) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeMapType' });
    const tile = <TileMapSettingsInterface>this.user?.settings.dashboardSettings.tiles.find(tile => tile.order === this.order);
    if (tile) {
      tile.mapType = event.value;
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



