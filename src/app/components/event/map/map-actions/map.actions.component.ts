import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { AppAnalyticsService } from '../../../../services/app.analytics.service';

@Component({
  selector: 'app-map-actions',
  templateUrl: './map.actions.component.html',
  styleUrls: ['./map.actions.component.css'],
  providers: [],
  standalone: false
})

export class MapActionsComponent implements OnChanges {

  @Input() showLaps: boolean;
  @Input() showArrows: boolean;
  @Input() user: User;

  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showArrowsChange: EventEmitter<boolean> = new EventEmitter<boolean>();


  private analyticsService = inject(AppAnalyticsService);

  constructor(
    private userService: AppUserService) {
  }



  async checkBoxChanged(event) {
    this.showLapsChange.emit(this.showLaps);
    this.showArrowsChange.emit(this.showArrows);

    // debugger;
    if (this.user) {
      this.user.settings.mapSettings.showLaps = this.showLaps;
      this.user.settings.mapSettings.showArrows = this.showArrows;
      await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
    }
    this.analyticsService.logEvent('event_map_settings_change');
  }

  ngOnChanges(simpleChanges) {
    // debugger;
  }
}
