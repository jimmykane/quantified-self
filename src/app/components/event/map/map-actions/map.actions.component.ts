import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { User, UserMapSettingsInterface } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';

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
  @Input() user: User;

  @Output() showLapsChange = new EventEmitter<boolean>();
  @Output() showArrowsChange = new EventEmitter<boolean>();

  private analyticsService = inject(AppAnalyticsService);

  constructor(
    private userService: AppUserService) {
  }

  async checkBoxChanged(_event) {
    this.showLapsChange.emit(this.showLaps);
    this.showArrowsChange.emit(this.showArrows);

    if (this.user) {
      if (!this.user.settings.mapSettings) {
        this.user.settings.mapSettings = <UserMapSettingsInterface>{};
      }
      this.user.settings.mapSettings.showLaps = this.showLaps;
      this.user.settings.mapSettings.showArrows = this.showArrows;
      await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
    }
    this.analyticsService.logEvent('event_map_settings_change');
  }
}
