import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';


@Component({
  selector: 'app-event-details-card',
  templateUrl: './event.details.card.component.html',
  styleUrls: ['./event.details.card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventDetailsCardComponent {
  @Input() event: EventInterface;
}
