import {Component, Input} from '@angular/core';
import {EventService} from '../../../services/app.event.service';
import {Router} from '@angular/router';
import {EventInterface} from '../../../entities/events/event.interface';


@Component({
  selector: 'app-event-list',
  templateUrl: './event.list.component.html',
  styleUrls: ['./event.list.component.css'],
})
export class EventListComponent {
  @Input() events: EventInterface[];
  @Input() selectedEvent: EventInterface;

  constructor(private eventService: EventService, private router: Router) {}

  mergeEvents($event, event: EventInterface) {
    $event.stopPropagation();
    this.eventService.mergeEvents([this.selectedEvent, event]).then((event: EventInterface) => {
      this.eventService.addEvent(event);
      this.router.navigate(['/dashboard'], { queryParams: { eventID: event.getID() } });
    });
    return false;
  }
}
