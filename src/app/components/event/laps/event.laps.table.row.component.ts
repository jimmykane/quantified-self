import {ChangeDetectionStrategy, Component, Input, OnInit} from '@angular/core';
import {LapInterface} from '../../../entities/laps/lap.interface';

@Component({
  selector: '[app-event-lap-table-row]',
  templateUrl: './event.laps.table.row.component.html',
  styleUrls: ['./event.laps.table.row.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventLapTableRowComponent {
  @Input() lap: LapInterface;
  @Input() index: number;
  @Input() isFirst: boolean;
  @Input() isLast: boolean;
  @Input() count: number;
}
