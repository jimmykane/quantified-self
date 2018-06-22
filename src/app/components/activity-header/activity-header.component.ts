import {Component, Input} from '@angular/core';
import {AppEventColorService} from '../../services/color/app.event.color.service';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';

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
  @Input() showActions: boolean;

  constructor(public eventColorService: AppEventColorService) {
  }
}
