import { Directive, EventEmitter, Input, Output } from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppMapStyleName } from '../../../models/app-user.interface';

@Directive()
export abstract class MapLayersActionsBaseDirective {
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
}
