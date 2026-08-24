import { Component, ViewChild, inject } from '@angular/core';
import { MatMenu } from '@angular/material/menu';
import { AppMapStyleName } from '../../../models/app-user.interface';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
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
  private hapticsService = inject(AppHapticsService);
  private mapStyleService = inject(MapStyleService);

  public get mapStyleOptions() {
    return this.mapStyleService.getSupportedStyleOptions();
  }

  public onMapStyleSelect(style: AppMapStyleName): void {
    const nextMapStyle = this.mapStyleService.normalizeStyle(style);
    const didChange = nextMapStyle !== this.mapStyle;
    this.mapStyle = nextMapStyle;
    this.emitAllChanges();
    if (didChange) {
      this.hapticsService.selection();
    }
  }

  public onShow3DToggle(checked: boolean): void {
    const didChange = checked !== this.is3D;
    this.is3D = checked;
    this.emitAllChanges();
    if (didChange) {
      this.hapticsService.selection();
    }
  }

  public onShowJumpHeatmapToggle(checked: boolean): void {
    const didChange = checked !== this.showJumpHeatmap;
    this.showJumpHeatmap = checked;
    this.emitAllChanges();
    if (didChange) {
      this.hapticsService.selection();
    }
  }

  public onShowLapsToggle(checked: boolean): void {
    const didChange = checked !== this.showLaps;
    this.showLaps = checked;
    this.emitAllChanges();
    if (didChange) {
      this.hapticsService.selection();
    }
  }

  public onShowArrowsToggle(checked: boolean): void {
    const didChange = checked !== this.showArrows;
    this.showArrows = checked;
    this.emitAllChanges();
    if (didChange) {
      this.hapticsService.selection();
    }
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
