import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {MatDialog, MatSnackBar} from '@angular/material';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {ActivityFormComponent} from '../activity-form/activity.form.component';
import {User} from 'quantified-self-lib/lib/users/user';
import {EventUtilities} from "quantified-self-lib/lib/events/utilities/event.utilities";
import {take} from "rxjs/operators";

@Component({
  selector: 'app-activity-actions',
  templateUrl: './activity.actions.component.html',
  styleUrls: ['./activity.actions.component.css'],
  providers: [],
})
export class ActivityActionsComponent implements OnInit {
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() activity: ActivityInterface;

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    public dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user || !this.event) {
      throw 'Component needs events and user';
    }
  }

  editActivity() {
    const dialogRef = this.dialog.open(ActivityFormComponent, {
      width: '75vw',
      data: {
        event: this.event,
        activity: this.activity,
        user: this.user
      },
    });

    // dialogRef.afterClosed().subscribe(result => {
    //
    // });
  }

  async reGenerateStatistics() {
    this.snackBar.open('Re-calculating activity statistics', null, {
      duration: 2000,
    });
    // To use this component we need the full hydrated object and we might not have it
    this.activity.clearStreams();
    this.activity.addStreams(await this.eventService.getAllStreams(this.user, this.event.getID(), this.activity.getID()).pipe(take(1)).toPromise());
    this.activity.clearStats();
    EventUtilities.generateMissingStreamsAndStatsForActivity(this.activity);
    EventUtilities.reGenerateStatsForEvent(this.event);
    await this.eventService.setEvent(this.user, this.event);
    this.snackBar.open('Activity and event statistics have been recalculated', null, {
      duration: 2000,
    });
  }

  async deleteActivity() {
    this.event.removeActivity(this.activity);
    await this.eventService.deleteAllActivityData(this.user, this.event.getID(), this.activity.getID());
    EventUtilities.reGenerateStatsForEvent(this.event);
    await this.eventService.setEvent(this.user, this.event);
    this.snackBar.open('Activity deleted', null, {
      duration: 2000,
    });
  }
}
