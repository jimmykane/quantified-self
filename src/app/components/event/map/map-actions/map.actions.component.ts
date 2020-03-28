import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {AppUserService} from '../../../../services/app.user.service';
import { AngularFireAnalytics } from '@angular/fire/analytics';

@Component({
  selector: 'app-map-actions',
  templateUrl: './map.actions.component.html',
  styleUrls: ['./map.actions.component.css'],
  providers: [],
})

export class MapActionsComponent implements OnChanges {

  @Input() showLaps: boolean;
  @Input() showArrows: boolean;
  @Input() user: User;

  @Output() showLapsChange: EventEmitter<boolean> = new EventEmitter<boolean>();
  @Output() showArrowsChange: EventEmitter<boolean> = new EventEmitter<boolean>();


  constructor(
    private userService: AppUserService,
    private afa: AngularFireAnalytics) {
  }

  async checkBoxChanged(event) {
    // debugger;
    if (this.user) {
      this.user.settings.mapSettings.showLaps = this.showLaps;
      this.user.settings.mapSettings.showArrows = this.showArrows;
      await this.userService.updateUserProperties(this.user, {settings: this.user.settings})
    }
    this.showLapsChange.emit(this.showLaps);
    this.showArrowsChange.emit(this.showArrows);
    return this.afa.logEvent('event_map_settings_change');
  }

  ngOnChanges(simpleChanges) {
    // debugger;
  }
}
