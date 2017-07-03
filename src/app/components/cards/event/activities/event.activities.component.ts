import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {Event} from '../../../../entities/events/event';
import {EventService} from '../../../../services/app.event.service';
import {EventInterface} from '../../../../entities/events/event.interface';


@Component({
  selector: 'app-event-activities',
  templateUrl: './event.activities.component.html',
  styleUrls: ['./event.activities.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventActivitiesCardComponent {
  @Input() event: EventInterface;

  constructor(private eventService: EventService) {}

  mergeAllActivities(event: Event) {
    this.eventService.mergeAllEventActivities(event).then((resultEvent) => {
      this.eventService.saveEvent(resultEvent);
    });
  }
}
