import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { EventInterface, ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppActivitySelectionService } from '../../../services/activity-selection-service/app-activity-selection.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-activities-toggles',
  templateUrl: './activities-toggles.component.html',
  styleUrls: ['./activities-toggles.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class ActivitiesTogglesComponent implements OnInit, OnDestroy {
  @Input() isOwner?: boolean;
  @Input() event!: EventInterface;
  @Input() user?: User;

  private selectedActivitiesSubscription?: Subscription;

  constructor(
    public activitySelectionService: AppActivitySelectionService,
    public eventColorService: AppEventColorService,
    private changeDetectorRef: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.selectedActivitiesSubscription = this.activitySelectionService.selectedActivities.changed
      .asObservable()
      .subscribe(() => {
        this.changeDetectorRef.detectChanges();
      });
  }

  ngOnDestroy() {
    if (this.selectedActivitiesSubscription) {
      this.selectedActivitiesSubscription.unsubscribe();
    }
  }

  /**
   * Determines if device names should be shown.
   * Returns true only if activities come from different devices.
   */
  get shouldShowDeviceNames(): boolean {
    const activities = this.event.getActivities();
    if (activities.length <= 1) {
      return false;
    }
    const deviceIdentifiers = activities.map(a =>
      `${a.creator?.name || ''}-${a.creator?.serialNumber || ''}`
    );
    return new Set(deviceIdentifiers).size > 1;
  }

  /**
   * Gets the device display name for an activity.
   */
  getDeviceName(activity: ActivityInterface): string {
    const name = activity.creator?.name || '';
    const swInfo = activity.creator?.swInfo || '';
    return swInfo ? `${name} ${swInfo}` : name;
  }

  /**
   * Check if an activity is selected.
   */
  isSelected(activity: ActivityInterface): boolean {
    return this.activitySelectionService.selectedActivities.isSelected(activity);
  }

  /**
   * Toggle activity selection.
   */
  toggleActivity(activity: ActivityInterface): void {
    if (this.isSelected(activity)) {
      this.activitySelectionService.selectedActivities.deselect(activity);
    } else {
      this.activitySelectionService.selectedActivities.select(activity);
    }
  }

  /**
   * Get the color for an activity.
   */
  getActivityColor(activity: ActivityInterface): string {
    return this.eventColorService.getActivityColor(this.event.getActivities(), activity);
  }
}
