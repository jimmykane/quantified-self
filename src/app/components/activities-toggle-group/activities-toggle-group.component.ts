import {Component, EventEmitter, Input, OnChanges, OnInit, Output} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventColorService} from '../../services/color/app.event.color.service';

@Component({
  selector: 'app-activities-toggle-groups',
  templateUrl: './activities-toggle-group.component.html',
  styleUrls: ['./activities-toggle-group.component.css'],
})

// @todo use selection model
export class ActivitiesToggleGroupComponent implements OnChanges, OnInit {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Output() selectedActivitiesChange: EventEmitter<ActivityInterface[]> = new EventEmitter<ActivityInterface[]>();
  activitiesCheckboxes: { activity: ActivityInterface, checked: boolean, intermediate: boolean, disabled: boolean }[] = [];

  constructor(public eventColorService: EventColorService) {

  }

  ngOnInit() {

  }


  ngOnChanges(simpleChanges): void {
    this.createCheckboxes();
    this.updateCheckboxValues();
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

  private createCheckboxes(){
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

  private updateCheckboxValues(){
    this.activitiesCheckboxes.forEach((activityCheckBox) => {
      activityCheckBox.checked = !!this.selectedActivities
        .find(selectedActivity => selectedActivity.getID() === activityCheckBox.activity.getID());
    });
  }
}
