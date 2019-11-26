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
import {EventColorService} from '../../services/color/app.event.color.service';
import {ActivitySelectionService} from '../../services/activity-selection-service/activity-selection.service';
import {Subscription} from 'rxjs';
import {MatButtonToggleChange} from '@angular/material/button-toggle';
import {MatSlideToggleChange} from '@angular/material/slide-toggle';
import {User} from 'quantified-self-lib/lib/users/user';

@Component({
  selector: 'app-activities-toggles',
  templateUrl: './activities-toggles.component.html',
  styleUrls: ['./activities-toggles.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush, // @todo not sure
})

export class ActivitiesTogglesComponent implements OnChanges, OnInit, OnDestroy {
  @Input() activities: ActivityInterface[];
  @Input() color: string;
  @Input() isOwner?: boolean;
  @Input() user?: User;
  @Input() event?: EventInterface;
  @Input() isMerge: boolean; // Should show additional info

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
