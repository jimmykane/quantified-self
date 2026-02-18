import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';
import { AppMapStyleName } from '../../../../models/app-user.interface';

@Component({
  selector: 'app-map-actions',
  templateUrl: './map.actions.component.html',
  styleUrls: ['./map.actions.component.css'],
  providers: [],
  standalone: false
})

export class MapActionsComponent {

  @Input() showLaps: boolean;
  @Input() showArrows: boolean;
  @Input() is3D = false;
  @Input() mapStyle: AppMapStyleName = 'default';
  @Input() user: User;

  @Output() showLapsChange = new EventEmitter<boolean>();
  @Output() showArrowsChange = new EventEmitter<boolean>();
  @Output() is3DChange = new EventEmitter<boolean>();
  @Output() mapStyleChange = new EventEmitter<AppMapStyleName>();

  private analyticsService = inject(AppAnalyticsService);

  onShowLapsToggle(checked: boolean) {
    this.showLaps = checked;
    this.checkBoxChanged();
  }

  onShowArrowsToggle(checked: boolean) {
    this.showArrows = checked;
    this.checkBoxChanged();
  }

  onMapStyleSelect(style: AppMapStyleName) {
    this.mapStyle = style;
    this.checkBoxChanged();
  }

  onShow3DToggle(checked: boolean) {
    this.is3D = checked;
    this.checkBoxChanged();
  }

  checkBoxChanged() {
    this.showLapsChange.emit(this.showLaps);
    this.showArrowsChange.emit(this.showArrows);
    this.is3DChange.emit(this.is3D);
    this.mapStyleChange.emit(this.mapStyle);
    this.analyticsService.logEvent('event_map_settings_change');
  }
}
