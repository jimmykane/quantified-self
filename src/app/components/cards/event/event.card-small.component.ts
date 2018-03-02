import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';
import {ActivityInterface} from '../../../entities/activities/activity.interface';


@Component({
  selector: 'app-event-card-small',
  templateUrl: './event.card-small.component.html',
  styleUrls: ['./event.card-small.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardSmallComponent {
  @Input() event: EventInterface;
  @Input() classActive: boolean;
}
