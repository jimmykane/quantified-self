import {
  Component, OnChanges, OnDestroy,
  OnInit
} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {List} from 'immutable';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  public events: List<EventInterface> = List([]);

  private eventsSubscription: Subscription;

  constructor(private eventService: EventService) {}

  ngOnInit() {
    // Fetch the events from the service
    this.eventsSubscription = this.eventService.getEvents().subscribe((events: List<EventInterface>) => {
      this.events = events;
    });
  }

  ngOnChanges() {
  }

  ngOnDestroy(): void {
    this.eventsSubscription.unsubscribe();
  }
}
