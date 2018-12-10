import {
  Component, OnChanges, OnDestroy,
  OnInit
} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {Subscription} from 'rxjs';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {
  events: EventInterface[];
  eventsSubscription: Subscription;

  constructor(private eventService: EventService) {
    this.eventsSubscription = this.eventService.getEvents().subscribe((eventsArray) => {
      this.events = eventsArray;
    });
  }

  ngOnInit() {
  }

  ngOnChanges() {
  }

  ngOnDestroy(): void {
    this.eventsSubscription.unsubscribe();
  }
}
