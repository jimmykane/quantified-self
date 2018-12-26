import {Component, OnInit} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {ActivatedRoute, Params} from '@angular/router';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';


@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.css'],
})
export class SideNavComponent implements OnInit {

  public events: EventInterface[] = [];
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
    });
  }
}
