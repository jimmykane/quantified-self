import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, OnChanges, OnDestroy,
  OnInit
} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {List} from 'immutable';
import {Subscription} from 'rxjs/Subscription';
import {EventInterface} from '../../entities/events/event.interface';
import {EventUtilities} from '../../entities/events/utilities/event.utilities';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class DashboardComponent implements OnInit, OnDestroy, OnChanges {

  public events: List<EventInterface> = List([]);
  public selectedEvent: EventInterface;

  private eventsSubscription: Subscription;

  constructor(private eventService: EventService,
              private changeDetectorRef: ChangeDetectorRef,
              private route: ActivatedRoute,
              private router: Router) {
  }

  mergeEvents($event, event: EventInterface) {
    $event.stopPropagation();
    EventUtilities.mergeEvents([this.selectedEvent, event]).then((mergedEvent: EventInterface) => {
        this.eventService.addAndSaveEvent(mergedEvent);
    });
  }

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
