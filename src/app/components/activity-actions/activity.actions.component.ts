import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {MatDialog, MatSnackBar} from '@angular/material';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {ActivityFormComponent} from '../activity-form/activity.form.component';

@Component({
  selector: 'app-activity-actions',
  templateUrl: './activity.actions.component.html',
  styleUrls: ['./activity.actions.component.css'],
  providers: [],
})
export class ActivityActionsComponent {
  @Input() event: EventInterface;
  @Input() activity: ActivityInterface;

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    public dialog: MatDialog) {
  }

  editActivity() {
    const dialogRef = this.dialog.open(ActivityFormComponent, {
      width: '75vh',
      data: {
        event: this.event,
        activity: this.activity,
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('The dialog was closed');
    });
  }

  deleteActivity() {
    console.log(this.event.getActivities().length);
    // @todo fix event stats
    this.event.removeActivity(this.activity);
    console.log(this.event.getActivities().length);

    this.eventService.addEvent(this.event).then((event) => {
      this.router.navigate(['/dashboard']);
      // this.router.navigate(['/dashboard'], {queryParams: {eventID: this.event.getID(), tabIndex: 0}});
      this.snackBar.open('Activity deleted', null, {
        duration: 5000,
      });
    });
  }
}
