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
export class ActivityToggleComponent implements OnInit {
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
  private destroyRef = inject(DestroyRef);
  public eventColorService = inject(AppEventColorService);
  public activitySelectionService = inject(AppActivitySelectionService);

  // Computed: cache selection status
  isSelected = computed(() => this.selectedActivities().some(a => a.getID() === this.activity().getID()));

  // Computed: cache activity color
  activityColor = computed(() => this.eventColorService.getActivityColor(this.event().getActivities(), this.activity()));

  ngOnInit() {
  }

  onActivitySelect(event: MatSlideToggleChange, activity: ActivityInterface) {
    event.checked
      ? this.activitySelectionService.selectedActivities.select(activity)
      : this.activitySelectionService.selectedActivities.deselect(activity);
  }

  onActivityClick(event: Event, activity: ActivityInterface) {
    this.activitySelectionService.selectedActivities.isSelected(activity)
      ? this.activitySelectionService.selectedActivities.deselect(activity)
      : this.activitySelectionService.selectedActivities.select(activity);
  }
}
