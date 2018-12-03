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
import {UserSettingsService} from '../../../services/app.user.settings.service';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  public event: EventInterface;
  public selectedTabIndex;
  public eventID: string;
  public selectedActivities: ActivityInterface[] = [];
  public eventHasPointsWithPosition: boolean;

  public showMapAutoLaps: boolean;
  public showMapManualLaps: boolean;
  public showMapDataWarnings: boolean;
  public showData: boolean;

  public useDistanceAxis: boolean;

  private parametersSubscription: Subscription;
  private eventSubscription: Subscription;

  constructor(
    public router: Router,
    private route: ActivatedRoute,
    private eventService: EventService,
    private userSettingsService: UserSettingsService,
    public eventColorService: AppEventColorService) {
  }

  ngOnChanges() {
    // debugger;
  }

  async ngOnInit() {
    this.userSettingsService.getShowAutoLaps().then(value => this.showMapAutoLaps = value);
    this.userSettingsService.getShowManualLaps().then(value => this.showMapManualLaps = value);
    this.userSettingsService.getShowData().then(value => this.showData = value);
    this.userSettingsService.showDataWarnings().then(value => this.showMapDataWarnings = value);
    this.userSettingsService.useDistanceAxis().then(value => this.useDistanceAxis = value);

    // Subscribe to route changes
    this.parametersSubscription = this.route.queryParams.subscribe((params: Params) => {
      this.selectedTabIndex = +params['tabIndex'];

      // If there is an ID change then unsubscribe and resubscribe to the new id
      if (this.eventID !== params['eventID']) {
        debugger;
        this.eventID = params['eventID'];
        if (this.eventSubscription) {
          this.eventSubscription.unsubscribe();
        }
        this.selectedActivities = [];
        // Subscribe to event changes
        this.eventSubscription = this.eventService.getEvent(this.eventID).subscribe((event: EventInterface) => {
          this.event = event;
          this.eventHasPointsWithPosition = !!this.event.getPointsWithPosition().length;
          this.selectedActivities = this.selectedActivities.length ? this.selectedActivities : this.event.getActivities();
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.parametersSubscription.unsubscribe();
    this.eventSubscription.unsubscribe();
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
