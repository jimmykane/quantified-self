import {Component, EventEmitter, Input, OnChanges, OnInit, Output} from '@angular/core';
import {AppEventColorService} from '../../services/color/app.event.color.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';

@Component({
  selector: 'app-activities-checkboxes',
  templateUrl: './activities-checkboxes.component.html',
  styleUrls: ['./activities-checkboxes.component.css'],
})

// @todo use selection model
export class ActivitiesCheckboxesComponent implements OnChanges, OnInit {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Output() selectedActivitiesChange: EventEmitter<ActivityInterface[]> = new EventEmitter<ActivityInterface[]>();
  activitiesCheckboxes: { activity: ActivityInterface, checked: boolean, intermediate: boolean, disabled: boolean }[] = [];

  constructor(public eventColorService: AppEventColorService) {

  }

  ngOnInit() {
    this.activitiesCheckboxes = this.event.getActivities().reduce((activitiesCheckboxes, activity) => {
      activitiesCheckboxes.push({
        activity: activity,
        checked: !!this.selectedActivities.find(selectedActivity => selectedActivity === activity),
        intermediate: false,
        disabled: false,
      });
      return activitiesCheckboxes;
    }, []);
  }


  ngOnChanges(simpleChanges): void {
    // Create the checkboxes
    this.activitiesCheckboxes.forEach((activityCheckBox) => {
      activityCheckBox.checked = !!this.selectedActivities
        .find(selectedActivity => selectedActivity.getID() === activityCheckBox.activity.getID());
    });

  }

  onCheckboxChange() {
    this.selectedActivities = this.activitiesCheckboxes.reduce((activities: ActivityInterface[], activityCheckbox) => {
      if (activityCheckbox.checked) {
        activities.push(activityCheckbox.activity)
      }
      return activities;
    }, []);
    this.selectedActivitiesChange.emit(this.selectedActivities);
  }
}
