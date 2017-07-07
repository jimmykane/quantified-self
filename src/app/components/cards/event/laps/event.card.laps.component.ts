import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';

@Component({
  selector: 'app-event-card-laps',
  templateUrl: './event.card.laps.component.html',
  styleUrls: ['./event.card.laps.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardLapsComponent {
  @Input() event: EventInterface;
  this.lapData: {startDate: Date, endDate: Date, distance: number, }

}
