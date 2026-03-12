import { Component, ViewChild, inject } from '@angular/core';
import { MatMenu } from '@angular/material/menu';
import { AppMapStyleName } from '../../../models/app-user.interface';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { MapStyleService } from '../../../services/map-style.service';
import { MapLayersActionsBaseDirective } from './map-layers-actions-base.directive';

@Component({
  selector: 'app-map-layers-menu-panel',
  templateUrl: './map-layers-menu-panel.component.html',
  styleUrls: ['./map-layers-menu-panel.component.css'],
  standalone: false
})
export class MapLayersMenuPanelComponent extends MapLayersActionsBaseDirective {
  @ViewChild('menu', { static: true }) public menu!: MatMenu;

  private analyticsService = inject(AppAnalyticsService);
  private mapStyleService = inject(MapStyleService);

  public get mapStyleOptions() {
    return this.mapStyleService.getSupportedStyleOptions();
  }

  public onMapStyleSelect(style: AppMapStyleName): void {
    this.mapStyle = this.mapStyleService.normalizeStyle(style);
    this.emitAllChanges();
  }

  public onShow3DToggle(checked: boolean): void {
    this.is3D = checked;
    this.emitAllChanges();
  }

  public onShowJumpHeatmapToggle(checked: boolean): void {
    this.showJumpHeatmap = checked;
    this.emitAllChanges();
  }

  public onShowLapsToggle(checked: boolean): void {
    this.showLaps = checked;
    this.emitAllChanges();
  }

  public onShowArrowsToggle(checked: boolean): void {
    this.showArrows = checked;
    this.emitAllChanges();
  }

  private emitAllChanges(): void {
    this.mapStyleChange.emit(this.mapStyle);
    this.is3DChange.emit(this.is3D);
    this.showJumpHeatmapChange.emit(this.showJumpHeatmap);
    this.showLapsChange.emit(this.showLaps);
    this.showArrowsChange.emit(this.showArrows);
    if (this.analyticsEventName) {
      this.analyticsService.logEvent(this.analyticsEventName);
    }
  }
}
