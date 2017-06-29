import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';

@Component({
  selector: 'app-event-laps-table',
  templateUrl: './event.laps.table.component.html',
  styleUrls: ['./event.laps.table.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush

})

export class EventLapsTableComponent {
  @Input() event: EventInterface;
}
