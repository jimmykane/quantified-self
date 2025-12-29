import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { Analytics, logEvent } from '@angular/fire/analytics';

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


  constructor(
    private userService: AppUserService,
    private analytics: Analytics) {
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
    return logEvent(this.analytics, 'event_map_settings_change');
  }

  ngOnChanges(simpleChanges) {
    // debugger;
  }
}
