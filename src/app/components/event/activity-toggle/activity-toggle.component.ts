import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { EventInterface, ActivityInterface } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppActivitySelectionService } from '../../../services/activity-selection-service/app-activity-selection.service';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import { isMergeOrBenchmarkEvent } from '../../../helpers/event-visibility.helper';

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
  showToggle = input<boolean>(true);
  showDate = input<boolean>(true);
  showStats = input<boolean>(true);

  // Injected services
  public eventColorService = inject(AppEventColorService);
  public activitySelectionService = inject(AppActivitySelectionService);

  // Computed: cache selection status
  isSelected = computed(() => this.isActivitySelected(this.activity()));

  // Computed: cache activity color
  activityColor = computed(() => this.eventColorService.getActivityColor(this.event().getActivities(), this.activity()));

  // Merge or benchmark events should use device name as the primary label.
  useDeviceNameAsPrimaryLabel = computed(() => isMergeOrBenchmarkEvent(this.event()));

  primaryLabel = computed(() => {
    const activity = this.activity();
    if (!activity) {
      return '';
    }

    if (!this.useDeviceNameAsPrimaryLabel()) {
      return activity.type || '';
    }

    const name = `${activity.creator?.name || ''}`.trim();
    const swInfo = `${activity.creator?.swInfo || ''}`.trim();
    const label = swInfo ? `${name} ${swInfo}` : name;
    return label || activity.type || '';
  });

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
