import {Component, EventEmitter, Input, OnChanges, OnInit, Output} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActivityInterface} from '../../entities/activities/activity.interface';

@Component({
  selector: 'app-activities-checkboxes',
  templateUrl: './activities-checkboxes.component.html',
  styleUrls: ['./activities-checkboxes.component.css'],
})

export class ActivitiesCheckboxesComponent implements OnChanges, OnInit {
  @Input() event: EventInterface;
  @Output() selectedActivities: EventEmitter<ActivityInterface[]> = new EventEmitter();

  activitiesCheckboxes: any[];

  ngOnInit() {
    this.onCheckboxChange();
  }

  ngOnChanges(): void {
    // Create the checkboxes
    this.activitiesCheckboxes = [];
    let index = 0;
    for (const activity of this.event.getActivities()) {
      this.activitiesCheckboxes.push({
        activity: activity,
        checked: index === 0,
        intermediate: false,
        disabled: false,
      });
      index++;
    }
  }

  onCheckboxChange() {
    this.selectedActivities.emit(
      this.activitiesCheckboxes.reduce((activities: ActivityInterface[], activityCheckbox) => {
        if (activityCheckbox.checked) {
          activities.push(activityCheckbox.activity)
        }
        return activities;
      }, [])
    );
  }
}
