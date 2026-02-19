import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppMapStyleName } from '../../../models/app-user.interface';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { MapStyleService } from '../../../services/map-style.service';

@Component({
  selector: 'app-map-layers-actions',
  templateUrl: './map-layers-actions.component.html',
  styleUrls: ['./map-layers-actions.component.css'],
  standalone: false
})
export class MapLayersActionsComponent {
  @Input() user: User;
  @Input() disabled = false;
  @Input() mapStyle: AppMapStyleName = 'default';
  @Input() is3D = false;
  @Input() showJumpHeatmap = false;
  @Input() showLaps = false;
  @Input() showArrows = false;
  @Input() enableJumpHeatmapToggle = false;
  @Input() enableLapsToggle = false;
  @Input() enableArrowsToggle = false;
  @Input() enable3DToggle = true;
  @Input() analyticsEventName = 'event_map_settings_change';

  @Output() mapStyleChange = new EventEmitter<AppMapStyleName>();
  @Output() is3DChange = new EventEmitter<boolean>();
  @Output() showJumpHeatmapChange = new EventEmitter<boolean>();
  @Output() showLapsChange = new EventEmitter<boolean>();
  @Output() showArrowsChange = new EventEmitter<boolean>();

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
