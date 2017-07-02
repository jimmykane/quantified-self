import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardComponent {
  @Input() event: EventInterface;
}
