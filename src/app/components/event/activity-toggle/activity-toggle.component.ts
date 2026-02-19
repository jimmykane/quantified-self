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
    this.activitySelectionService.selectActivity(activity, this.selectedActivities());
  }

  private deselectActivity(activity: ActivityInterface): void {
    this.activitySelectionService.deselectActivity(activity, this.selectedActivities(), true);
  }

  private isActivitySelected(activity: ActivityInterface): boolean {
    return this.activitySelectionService.isActivitySelected(activity, this.selectedActivities());
  }
}
