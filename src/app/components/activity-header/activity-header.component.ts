import {Component, Input} from '@angular/core';
import {ActivityInterface} from '../../entities/activities/activity.interface';
import {AppEventColorService} from '../../services/app.event.color.service';
import {EventInterface} from '../../entities/events/event.interface';

@Component({
  selector: 'app-activity-header',
  templateUrl: './activity-header.component.html',
  styleUrls: ['./activity-header.component.css'],
})

export class ActivityHeaderComponent {
  @Input() activity: ActivityInterface;
  @Input() event: EventInterface;

  constructor(public eventColorService: AppEventColorService) {
  }
}
