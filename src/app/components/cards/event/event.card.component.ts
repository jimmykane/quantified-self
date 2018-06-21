import {
  Component,
  OnChanges,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {Subscription} from 'rxjs';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {AppEventColorService} from '../../../services/color/app.event.color.service';
import {EventService} from '../../../services/app.event.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  public event: EventInterface;
  public selectedTabIndex;
  public selectedActivities: ActivityInterface[];
  public eventHasPointsWithPosition: boolean;

  private parametersSubscription: Subscription;

  constructor(private route: ActivatedRoute,
              private router: Router,
              private eventService: EventService,
              public eventColorService: AppEventColorService) {
  }

  ngOnChanges() {
  }

  ngOnInit() {
    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
      this.selectedTabIndex = +params['tabIndex'];
      this.event = this.eventService.findEvent(params['eventID']);
      if (!this.event) {
        this.router.navigate(['/dashboard']);
        return;
      }
      this.eventHasPointsWithPosition = !!this.event.getPointsWithPosition().length;
      this.selectedActivities = [this.event.getFirstActivity()];
    });
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
  }

  hasLaps(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((lapsArray, activity) => lapsArray.concat(activity.getLaps()), []).length
  }

  hasIBIData(event: EventInterface) {
    return event.getActivities().find((activity: ActivityInterface) => {
      return activity.ibiData && !!activity.ibiData.getIBIDataMap().size;
    })
  }
}
