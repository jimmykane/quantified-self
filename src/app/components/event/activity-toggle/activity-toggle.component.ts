import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { EventInterface, ActivityInterface, User } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppActivitySelectionService } from '../../../services/activity-selection-service/app-activity-selection.service';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';

@Component({
  selector: 'app-activity-toggle',
  templateUrl: './activity-toggle.component.html',
  styleUrls: ['./activity-toggle.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ActivityToggleComponent {
  // Signal inputs
  event = input.required<EventInterface>();
  activity = input.required<ActivityInterface>();
  selectedActivities = input.required<ActivityInterface[]>();
  isOwner = input<boolean>();
  user = input<User>();
  showToggle = input<boolean>(true);
  showActions = input<boolean>();
  showDate = input<boolean>(true);
  showStats = input<boolean>(true);

  // Injected services
  public eventColorService = inject(AppEventColorService);
  public activitySelectionService = inject(AppActivitySelectionService);

  // Computed: cache selection status
  isSelected = computed(() => this.isActivitySelected(this.activity()));

  // Computed: cache activity color
  activityColor = computed(() => this.eventColorService.getActivityColor(this.event().getActivities(), this.activity()));

  onActivitySelect(event: MatSlideToggleChange, activity: ActivityInterface) {
    if (event.checked) {
      this.selectActivity(activity);
      return;
    }
    this.deselectActivity(activity);
  }

  onActivityClick(activity: ActivityInterface): void {
    this.isActivitySelected(activity)
      ? this.deselectActivity(activity)
      : this.selectActivity(activity);
  }

  private selectActivity(activity: ActivityInterface): void {
    if (this.isActivitySelected(activity)) {
      return;
    }
    this.activitySelectionService.selectedActivities.select(activity);
  }

  private deselectActivity(activity: ActivityInterface): void {
    const selectedActivityRef = this.findSelectedActivity(activity);
    if (!selectedActivityRef) {
      return;
    }
    this.activitySelectionService.selectedActivities.deselect(selectedActivityRef);
  }

  private isActivitySelected(activity: ActivityInterface): boolean {
    return !!this.findSelectedActivity(activity);
  }

  private findSelectedActivity(activity: ActivityInterface): ActivityInterface | undefined {
    const selectedActivities = this.selectedActivities() ?? [];
    const activityID = activity?.getID?.();

    if (activityID) {
      return selectedActivities.find((selectedActivity) => selectedActivity?.getID?.() === activityID);
    }

    return selectedActivities.find((selectedActivity) => selectedActivity === activity);
  }
}
