import {Component, EventEmitter, Input, OnChanges, OnInit, Output} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActivityInterface} from '../../entities/activities/activity.interface';
import {AppEventColorService} from "../../services/app.event.color.service";

@Component({
  selector: 'app-activities-checkboxes',
  templateUrl: './activities-checkboxes.component.html',
  styleUrls: ['./activities-checkboxes.component.css'],
})

// @todo use selection model
export class ActivitiesCheckboxesComponent implements OnChanges, OnInit {
  @Input() event: EventInterface;
  @Output() selectedActivities: EventEmitter<ActivityInterface[]> = new EventEmitter();
  activitiesCheckboxes: any[];

  constructor(public eventColorService: AppEventColorService) {

  }

  ngOnInit() {
  }

  ngOnChanges(): void {
    // Create the checkboxes
    this.activitiesCheckboxes = [];
    let index = 0;
    for (const activity of this.event.getActivities()) {
      this.activitiesCheckboxes.push({
        activity: activity,
        checked: index === 0, // force the 1st
        intermediate: false,
        disabled: false,
      });
      index++;
    }
    this.emitChanges();
  }

  onCheckboxChange() {
    this.emitChanges();
  }

  private emitChanges() {
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
