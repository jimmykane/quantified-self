import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit
} from '@angular/core';
import {EventInterface} from '../../../entities/events/event.interface';
import {Subscription} from 'rxjs/Subscription';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {AppEventColorService} from '../../../services/app.event.color.service';
import {ActivityInterface} from '../../../entities/activities/activity.interface';
import {EventService} from '../../../services/app.event.service';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  @Input() eventPromise: Promise<EventInterface>;
  selectedTabIndex;

  private parametersSubscription: Subscription;

  constructor(private route: ActivatedRoute,
              private router: Router,
              private eventService: EventService,
              public eventColorService: AppEventColorService) {
  }

  ngOnChanges() {
    debugger;
  }

  ngOnInit() {
    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
      this.selectedTabIndex = +params['tabIndex'];
      this.eventPromise = this.eventService.getEvent(params['eventID']);
    });
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
  }

  hasIBIData(event: EventInterface) {
    return event.getActivities().find((activity: ActivityInterface) => {
      return activity.ibiData && !!activity.ibiData.getIBIDataMap().size;
    })
  }
}
