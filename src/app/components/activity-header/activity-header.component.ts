import {Component, Input} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventColorService} from '../../services/color/app.event.color.service';
import {User} from 'quantified-self-lib/lib/users/user';

@Component({
  selector: 'app-activity-header',
  templateUrl: './activity-header.component.html',
  styleUrls: ['./activity-header.component.css'],
})

export class ActivityHeaderComponent {
  @Input() activity: ActivityInterface;
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() showType = true;
  @Input() showIcon = false;
  @Input() showDistance = false;
  @Input() showDuration = true;
  @Input() showSWInfo: boolean;
  @Input() showSerialNumber: boolean;
  @Input() showActions: boolean;

  constructor(public eventColorService: EventColorService) {
  }
}
