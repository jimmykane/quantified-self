import {ChangeDetectionStrategy, Component, Input, OnInit} from '@angular/core';
import {ActivityInterface} from '../../../../entities/activities/activity.interface';
import {EventInterface} from '../../../../entities/events/event.interface';


@Component({
  selector: '[app-event-activity-table-row]',
  templateUrl: './event.activity.table.row.component.html',
  styleUrls: ['./event.activity.table.row.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush

})
export class EventActivityTableRowComponent {
  @Input() activity: ActivityInterface;
  @Input() event: EventInterface;
  @Input() index: number;
  @Input() isFirst: boolean;
  @Input() isLast: boolean;
  @Input() count: number;
}
