import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { ActivityFormComponent } from '../activity-form/activity.form.component';
import { User } from '@sports-alliance/sports-lib';
import { EventUtilities } from '@sports-alliance/sports-lib';
import { take } from 'rxjs/operators';
import { DeleteConfirmationComponent } from '../delete-confirmation/delete-confirmation.component';
import { DataDistance } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-activity-actions',
  templateUrl: './activity.actions.component.html',
  styleUrls: ['./activity.actions.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [],
  standalone: false
})
export class ActivityActionsComponent implements OnInit, OnDestroy {
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() activity: ActivityInterface;

  private deleteConfirmationSubscription: any;

  constructor(
    private eventService: AppEventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
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
  }

  isHydrated() {
    return this.activity.getAllStreams().length > 0;
  }

  hasDistance() {
    return this.activity.hasStreamData(DataDistance.type);
  }

  async reGenerateStatistics() {
    this.snackBar.open('Re-calculating activity statistics', null, {
      duration: 2000,
    });
    // To use this component we need the full hydrated object and we might not have it
    // We attach streams from the original file (if exists) instead of Firestore
    const hydratedEvent = await this.eventService.attachStreamsToEventWithActivities(this.user, this.event as any).pipe(take(1)).toPromise();
    const hydratedActivity = hydratedEvent.getActivities().find(a => a.getID() === this.activity.getID());
    if (hydratedActivity) {
      this.activity.clearStreams();
      this.activity.addStreams(hydratedActivity.getAllStreams());
    }
    this.activity.clearStats();
    ActivityUtilities.generateMissingStreamsAndStatsForActivity(this.activity);
    EventUtilities.reGenerateStatsForEvent(this.event);
    await this.eventService.writeAllEventData(this.user, this.event);
    this.snackBar.open('Activity and event statistics have been recalculated', null, {
      duration: 2000,
    });
    this.changeDetectorRef.detectChanges();
  }

  async deleteActivity() {
    const dialogRef = this.dialog.open(DeleteConfirmationComponent);
    this.deleteConfirmationSubscription = dialogRef.afterClosed().subscribe(async (result) => {
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
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe()
    }
  }
}
