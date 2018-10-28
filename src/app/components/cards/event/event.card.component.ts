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
  public selectedActivities: ActivityInterface[] = [];
  public eventHasPointsWithPosition: boolean;

  public showMapAutoLaps: boolean;
  public showMapManualLaps: boolean;
  public showMapDataWarnings: boolean;
  public showData: boolean;

  public useDistanceAxis: boolean;

  private parametersSubscription: Subscription;

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
      // Reset the selected activities
      if (this.event && this.event.getID() !== params['eventID']) {
        this.selectedActivities = [];
      }
      this.event = this.eventService.findEvent(params['eventID']);
      if (!this.event) {
        this.router.navigate(['/dashboard']);
        return;
      }

      this.selectedTabIndex = +params['tabIndex'];
      this.eventHasPointsWithPosition = !!this.event.getPointsWithPosition().length;
      this.selectedActivities = this.selectedActivities.length ? this.selectedActivities : this.event.getActivities();
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
