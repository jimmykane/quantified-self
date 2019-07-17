import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {EventFormComponent} from '../event-form/event.form.component';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {UserSettingsService} from '../../services/app.user.settings.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {UserService} from '../../services/app.user.service';

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
    private userService: UserService) {
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

    // this.changeDetectorRef.detectChanges()
    // this.changeDetectorRef.markForCheck()
  }

  ngOnChanges(simpleChanges) {
    // debugger;
  }
}
