import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';

@Component({
  selector: 'app-event-laps-card',
  templateUrl: './event.laps.card.component.html',
  styleUrls: ['./event.laps.card.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventLapsCardComponent {
  @Input() event: EventInterface;
}
