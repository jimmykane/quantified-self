import {Component, OnInit} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {ActivatedRoute, Params} from '@angular/router';
import {List} from 'immutable';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';


@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.css'],
})
export class SideNavComponent implements OnInit {

  public events: List<EventInterface> = List([]);
  public selectedEvent: EventInterface;

  private parametersEventID: string;
  private parametersTabIndex: string;
  private parametersSubscription: Subscription;
  private eventsSubscription: Subscription;

  constructor(private eventService: EventService, private route: ActivatedRoute) {

  }

  ngOnInit() {
    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
      this.parametersEventID = params['eventID'];
      this.parametersTabIndex = params['tabIndex'];
      this.findSelectedEvent();
    });

    // Fetch the events from the service
    // this.eventsSubscription = this.eventService.getEvents().subscribe((events: List<EventInterface>) => {
    //   this.events = events;
    //   this.findSelectedEvent();
    // });
  }

  private findSelectedEvent() {
    this.selectedEvent = this.events.find((event: EventInterface) => {
      return event.getID() === this.parametersEventID;
    });
  }

}
