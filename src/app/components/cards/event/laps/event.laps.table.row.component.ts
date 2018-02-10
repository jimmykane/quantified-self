import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {LapInterface} from '../../../../entities/laps/lap.interface';
import {EventInterface} from '../../../../entities/events/event.interface';
import {EventService} from '../../../../services/app.event.service';

@Component({
  selector: '[app-event-lap-table-row]',
  templateUrl: './event.laps.table.row.component.html',
  styleUrls: ['./event.laps.table.row.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventLapTableRowComponent {
  @Input() event: EventInterface;
  @Input() lap: LapInterface;
  @Input() index: number;
  @Input() isFirst: boolean;
  @Input() isLast: boolean;
  @Input() count: number;

  constructor(public eventService: EventService){

  }
}
