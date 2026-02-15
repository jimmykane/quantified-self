import {
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataDeviceNames, EventInterface, ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppActivitySelectionService } from '../../../services/activity-selection-service/app-activity-selection.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppEventService } from '../../../services/app.event.service';
import { DeviceNameEditDialogComponent } from './device-name-edit-dialog/device-name-edit-dialog.component';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-activities-toggles',
  templateUrl: './activities-toggles.component.html',
  styleUrls: ['./activities-toggles.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ActivitiesTogglesComponent {
  // Signal inputs
  event = input.required<EventInterface>();
  selectedActivities = input.required<ActivityInterface[]>();
  isOwner = input<boolean>();
  user = input<User>();

  // Injected services
  private changeDetectorRef = inject(ChangeDetectorRef);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private eventService = inject(AppEventService);
  public activitySelectionService = inject(AppActivitySelectionService);
  public eventColorService = inject(AppEventColorService);

  // Computed: cache activities array - won't recompute unless event changes
  activities = computed(() => this.event()?.getActivities() ?? []);

  // Computed: pre-calculate colors for all activities
  activityColors = computed(() => {
    const acts = this.activities();
    const colorMap = new Map<string, string>();
    acts.forEach(activity => {
      colorMap.set(activity.getID(), this.eventColorService.getActivityColor(acts, activity));
    });
    return colorMap;
  });

  // Computed: check if device names should show
  shouldShowDeviceNames = computed(() => {
    if (!this.event()?.isMerge) return false;
    const acts = this.activities();
    if (acts.length <= 1) return false;
    const ids = acts.map(a => `${a.creator?.name || ''}-${a.creator?.serialNumber || ''}`);
    return new Set(ids).size > 1;
  });

  // Computed: normalize current selection into fast lookup sets.
  selectedState = computed(() => {
    const selectedActivities = this.selectedActivities() ?? [];
    const selectedIDs = new Set<string>();
    const selectedRefs = new Set<ActivityInterface>();

    selectedActivities.forEach((selectedActivity) => {
      selectedRefs.add(selectedActivity);
      const selectedID = selectedActivity?.getID?.();
      if (selectedID) {
        selectedIDs.add(selectedID);
      }
    });

    return {
      selectedIDs,
      selectedRefs,
      selectedCount: selectedActivities.length,
    };
  });

  /**
   * Check if an activity is selected.
   */
  isSelected(activity: ActivityInterface): boolean {
    const state = this.selectedState();
    const activityID = activity?.getID?.();
    if (activityID) {
      return state.selectedIDs.has(activityID);
    }
    return state.selectedRefs.has(activity);
  }

  /**
   * Toggle activity selection.
   */
  toggleActivity(activity: ActivityInterface): void {
    const isSelected = this.isSelected(activity);
    const selectedCount = this.selectedState().selectedCount;

    if (isSelected) {
      if (selectedCount <= 1) {
        return;
      }
      this.activitySelectionService.selectedActivities.deselect(activity);
    } else {
      this.activitySelectionService.selectedActivities.select(activity);
    }
  }

  canDeselectActivity(activity: ActivityInterface): boolean {
    return !this.isSelected(activity) || this.selectedState().selectedCount > 1;
  }

  isOnlySelectedActivity(activity: ActivityInterface): boolean {
    return this.selectedState().selectedCount === 1 && this.isSelected(activity);
  }

  async renameDevice(activity: ActivityInterface): Promise<void> {
    const user = this.user();
    const event = this.event();
    if (!user || !event) {
      return;
    }

    const currentName = `${activity.creator?.name ?? ''}`.trim();
    const dialogRef = this.dialog.open(DeviceNameEditDialogComponent, {
      width: '420px',
      data: {
        activityID: activity.getID(),
        currentName,
        swInfo: activity.creator?.swInfo || '',
      },
    });

    const newName = await firstValueFrom(dialogRef.afterClosed());
    if (!newName) {
      return;
    }

    const previousName = activity.creator.name;
    activity.creator.name = newName;

    try {
      event.addStat(new DataDeviceNames(event.getActivities().map((eventActivity) => eventActivity.creator?.name || '')));
      await this.eventService.writeActivityAndEventData(user, event, activity);
      this.snackBar.open('Device name updated', undefined, { duration: 2500 });
    } catch {
      activity.creator.name = previousName;
      this.snackBar.open('Could not update device name', undefined, { duration: 3500 });
    } finally {
      this.changeDetectorRef.markForCheck();
    }
  }

  /**
   * Get the device display name for an activity.
   */
  getDeviceName(activity: ActivityInterface): string {
    const name = activity.creator?.name || '';
    const swInfo = activity.creator?.swInfo || '';
    return swInfo ? `${name} ${swInfo}` : name;
  }

  /**
   * Get the color for an activity from the pre-calculated map.
   */
  getActivityColor(activity: ActivityInterface): string {
    return this.activityColors().get(activity.getID()) || '#000';
  }

  /**
   * Track activities by ID for better rendering performance.
   */
  trackByActivityId(index: number, activity: ActivityInterface): string {
    return activity.getID() || `idx-${index}`;
  }
}
