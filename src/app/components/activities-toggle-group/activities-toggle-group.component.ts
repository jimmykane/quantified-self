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

@Component({
  selector: 'app-activities-toggle-groups',
  templateUrl: './activities-toggle-group.component.html',
  styleUrls: ['./activities-toggle-group.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush, // @todo not sure
})

export class ActivitiesToggleGroupComponent implements OnChanges, OnInit, OnDestroy {
  @Input() activities: ActivityInterface[];

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

  onActivitySelect(event: MatButtonToggleChange) {
    event.source.checked ?
      this.activitySelectionService.selectedActivities.select(event.value)
      : this.activitySelectionService.selectedActivities.deselect(event.value);
  }

  ngOnDestroy(): void {
    if (this.selectedActivitiesSubscription) {
      this.selectedActivitiesSubscription.unsubscribe();
    }
  }
}
