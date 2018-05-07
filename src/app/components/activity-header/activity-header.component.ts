import {Component, Input} from '@angular/core';
import {ActivityInterface} from '../../entities/activities/activity.interface';
import {AppEventColorService} from '../../services/color/app.event.color.service';
import {EventInterface} from '../../entities/events/event.interface';

@Component({
  selector: 'app-activity-header',
  templateUrl: './activity-header.component.html',
  styleUrls: ['./activity-header.component.css'],
})

export class ActivityHeaderComponent {
  @Input() activity: ActivityInterface;
  @Input() event: EventInterface;
  @Input() showType = true;
  @Input() showIcon = false;
  @Input() showDistance = false;
  @Input() showDuration = true;
  @Input() showSWInfo: boolean;
  @Input() showSerialNumber: boolean;

  constructor(public eventColorService: AppEventColorService) {
  }
}
