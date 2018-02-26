import {Component, Input, Output} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActivityInterface} from '../../entities/activities/activity.interface';

@Component({
  selector: 'app-activity-icon',
  templateUrl: './activities-checkboxes.component.html',
  styleUrls: ['./activities-checkboxes.component.css'],
})

export class ActivityIconComponent {
  @Input() event: EventInterface;
  @Output() activities: ActivityInterface[];

}
