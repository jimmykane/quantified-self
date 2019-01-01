import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {MatDialog, MatSnackBar} from '@angular/material';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {ActivityFormComponent} from '../activity-form/activity.form.component';
import {User} from 'quantified-self-lib/lib/users/user';

@Component({
  selector: 'app-activity-actions',
  templateUrl: './activity.actions.component.html',
  styleUrls: ['./activity.actions.component.css'],
  providers: [],
})
export class ActivityActionsComponent implements OnInit{
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
    if (!this.user || !this.event){
      throw 'Component needs events and user';
    }
  }

  editActivity()  {
    const dialogRef = this.dialog.open(ActivityFormComponent, {
      width: '75vh',
      data: {
        event: this.event,
        activity: this.activity,
      },
    });

    dialogRef.afterClosed().subscribe(result => {

    });
  }

  deleteActivity() {
    this.eventService.deleteActivityForUser(this.user, this.event.getID(), this.activity.getID()).then(() => {
      this.snackBar.open('Activity deleted', null, {
        duration: 2000,
      });
    });
  }
}
