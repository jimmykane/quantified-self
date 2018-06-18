import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog} from '@angular/material';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';

@Component({
  selector: 'app-activity-actions',
  templateUrl: './activity.actions.component.html',
  styleUrls: ['./activity.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})
export class ActivityActionsComponent {
  @Input() event: EventInterface;
  @Input() activity: ActivityInterface;

  constructor(private eventService: EventService, private changeDetectorRef: ChangeDetectorRef, private router: Router, public dialog: MatDialog) {
  }

  editActivity() {
    const dialogRef = this.dialog.open(EventFormComponent, {
      width: '75vh',
      data: {
        event: event,
        activity: this.activity,
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('The dialog was closed');
    });
  }

  deleteActivity() {
    // @todo fix event stats
    this.event.removeActivity(this.activity);
    this.eventService.addAndReplace(this.event).then((event) => {

    });
  }
}
