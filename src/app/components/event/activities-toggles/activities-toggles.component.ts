import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs/operators';
import { EventInterface, ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppActivitySelectionService } from '../../../services/activity-selection-service/app-activity-selection.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';

@Component({
  selector: 'app-activities-toggles',
  templateUrl: './activities-toggles.component.html',
  styleUrls: ['./activities-toggles.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ActivitiesTogglesComponent implements OnInit {
  // Signal inputs
  event = input.required<EventInterface>();
  selectedActivities = input.required<ActivityInterface[]>();
  isOwner = input<boolean>();
  user = input<User>();

  // Injected services
  private destroyRef = inject(DestroyRef);
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
    const acts = this.activities();
    if (acts.length <= 1) return false;
    const ids = acts.map(a => `${a.creator?.name || ''}-${a.creator?.serialNumber || ''}`);
    return new Set(ids).size > 1;
  });

  ngOnInit() {
  }

  /**
   * Check if an activity is selected.
   */
  isSelected(activity: ActivityInterface): boolean {
    return this.selectedActivities().some(a => a.getID() === activity.getID());
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
    return activity.getID();
  }
}
