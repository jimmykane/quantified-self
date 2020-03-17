import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {AppEventService} from '../../services/app.event.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {ActivityInterface} from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import {ActivityFormComponent} from '../activity-form/activity.form.component';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {EventUtilities} from '@sports-alliance/sports-lib/lib/events/utilities/event.utilities';
import {take} from 'rxjs/operators';
import {DeleteConfirmationComponent} from '../delete-confirmation/delete-confirmation.component';
import { MatBottomSheet } from "@angular/material/bottom-sheet";

@Component({
  selector: 'app-activity-actions',
  templateUrl: './activity.actions.component.html',
  styleUrls: ['./activity.actions.component.css'],
  providers: [],
})
export class ActivityActionsComponent implements OnInit, OnDestroy {
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() activity: ActivityInterface;

  private deleteConfirmationSubscription;

  constructor(
    private eventService: AppEventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    private deleteConfirmationBottomSheet: MatBottomSheet,
    public dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user || !this.event) {
      throw new Error('Component needs events and user');
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
    await this.eventService.writeAllEventData(this.user, this.event);
    this.snackBar.open('Activity and event statistics have been recalculated', null, {
      duration: 2000,
    });
  }

  async deleteActivity() {
    const deleteConfirmationBottomSheet = this.deleteConfirmationBottomSheet.open(DeleteConfirmationComponent);
    this.deleteConfirmationSubscription = deleteConfirmationBottomSheet.afterDismissed().subscribe(async (result) => {
      if (!result) {
        return;
      }
      this.event.removeActivity(this.activity);
      await this.eventService.deleteAllActivityData(this.user, this.event.getID(), this.activity.getID());
      EventUtilities.reGenerateStatsForEvent(this.event);
      await this.eventService.writeAllEventData(this.user, this.event);
      this.snackBar.open('Activity deleted', null, {
        duration: 2000,
      });
    });
  }

  ngOnDestroy(): void {
    if (this.deleteConfirmationSubscription){
      this.deleteConfirmationSubscription.unsubscribe()
    }
  }
}
