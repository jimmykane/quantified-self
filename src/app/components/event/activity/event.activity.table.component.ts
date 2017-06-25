import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {Event} from '../../../entities/events/event';
import {EventService} from '../../../services/app.event.service';
import {EventInterface} from '../../../entities/events/event.interface';


@Component({
  selector: 'app-event-activity-table',
  templateUrl: './event.activity.table.component.html',
  styleUrls: ['./event.activity.table.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush

})
export class EventActivityTableComponent implements OnChanges {
  @Input() event: EventInterface;


  constructor(private eventService: EventService) {}

  ngOnChanges() {}

  mergeAllActivities(event: Event) {
    this.eventService.mergeAllEventActivities(event);
  }
}
