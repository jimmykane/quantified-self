import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {Event} from '../../../entities/events/event';
import {EventService} from '../../../services/app.event.service';
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
