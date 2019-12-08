import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output
} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventColorService} from '../../../../services/color/app.event.color.service';
import {ActivitySelectionService} from '../../../../services/activity-selection-service/activity-selection.service';
import {Subscription} from 'rxjs';
import {MatSlideToggleChange} from '@angular/material/slide-toggle';
import {User} from 'quantified-self-lib/lib/users/user';

@Component({
  selector: 'app-activity-toggle',
  templateUrl: './activity-toggle.component.html',
  styleUrls: ['./activity-toggle.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush, // @todo not sure
})

export class ActivityToggleComponent implements OnChanges, OnInit, OnDestroy {
  @Input() isOwner?: boolean;
  @Input() event: EventInterface;
  @Input() activity: ActivityInterface;
  @Input() user: User;
  @Input() showToggle = true;
  @Input() showActions?: boolean;
  @Input() showDate = true;
  @Input() showStats = true;

  private selectedActivitiesSubscription: Subscription;
  private selectedActivities: ActivityInterface[];

  constructor(public eventColorService: EventColorService, public activitySelectionService: ActivitySelectionService) {
  }

  ngOnInit() {
    this.selectedActivitiesSubscription = this.activitySelectionService.selectedActivities.changed.asObservable()
      .subscribe((selectedActivities) => {
        this.selectedActivities = selectedActivities.source.selected;
      })
  }

  ngOnChanges(simpleChanges): void {
  }

  onActivitySelect(event: MatSlideToggleChange, activity: ActivityInterface) {
    event.checked ?
      this.activitySelectionService.selectedActivities.select(activity)
      : this.activitySelectionService.selectedActivities.deselect(activity);
  }

  ngOnDestroy(): void {
    if (this.selectedActivitiesSubscription) {
      this.selectedActivitiesSubscription.unsubscribe();
    }
  }
}
