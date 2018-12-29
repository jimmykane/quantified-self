import {Component, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {EMPTY, Subscription} from 'rxjs';
import {ActivatedRoute, ParamMap, Router} from '@angular/router';
import {AppEventColorService} from '../../../services/color/app.event.color.service';
import {EventService} from '../../../services/app.event.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {UserSettingsService} from '../../../services/app.user.settings.service';
import {map, mergeMap, switchMap} from 'rxjs/operators';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {MatSnackBar} from '@angular/material';
import {AppAuthService, AppUser} from '../../../authentication/app.auth.service';
import {Log} from 'ng2-logger/browser';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  public event: EventInterface;
  public userFromParams: AppUser;
  public user: AppUser;
  public tabIndex;
  public streams: StreamInterface[] = [];
  public selectedActivities: ActivityInterface[] = [];

  public showMapAutoLaps: boolean;
  public showMapManualLaps: boolean;
  public showMapDataWarnings: boolean;
  public showData: boolean;
  public showAdvancedStats: boolean;

  public useDistanceAxis: boolean;

  private userSubscription: Subscription;
  private parametersSubscription: Subscription;
  private eventSubscription: Subscription;

  private logger = Log.create('EventCardComponent');

  constructor(
    public router: Router,
    private route: ActivatedRoute,
    private authService: AppAuthService,
    private eventService: EventService,
    private userSettingsService: UserSettingsService,
    private snackBar: MatSnackBar,
    public eventColorService: AppEventColorService) {
  }

  ngOnChanges() {
    // debugger;
  }

  async ngOnInit() {
    // Get the settings
    this.userSettingsService.getShowAutoLaps().then(value => this.showMapAutoLaps = value);
    this.userSettingsService.getShowManualLaps().then(value => this.showMapManualLaps = value);
    this.userSettingsService.getShowData().then(value => this.showData = value);
    this.userSettingsService.showDataWarnings().then(value => this.showMapDataWarnings = value);
    this.userSettingsService.useDistanceAxis().then(value => this.useDistanceAxis = value);
    this.userSettingsService.showAdvancedStats().then(value => this.showAdvancedStats = value);

    // Get the path params
    const userID = this.route.snapshot.paramMap.get('userID');
    const eventID = this.route.snapshot.paramMap.get('eventID');

    // Set a "user from params"
    this.userFromParams = {uid: userID};

    this.parametersSubscription = this.route.queryParamMap.subscribe(((queryParams) => {
      this.tabIndex = +queryParams.get('tabIndex');
    }));

    // Subscribe to authService and set the current user if possible
    this.userSubscription = this.authService.user.subscribe((user) => {
      this.user = user;
    });

    // Subscribe to the actual subject our event
    this.eventSubscription = this.eventService.getEventAndActivities(this.userFromParams, eventID).subscribe((event) => {
      if (!event) {
        this.router.navigate(['/dashboard']).then(() => {
          this.snackBar.open('Not found', null, {
            duration: 5000,
          });
        });
        return
      }
      this.event = event;
      this.selectedActivities = event.getActivities();
    });
  }

  async toggleEventPrivacy() {
    if (!this.isAllowedToEdit()) {
      return false
    }
    await this.eventService.updateEventProperties(this.user, this.event.getID(), {privacy: this.event.privacy === Privacy.private ? Privacy.public : Privacy.private})
  }

  isAllowedToEdit() {
    return !!(this.userFromParams && this.user && (this.userFromParams.uid === this.user.uid));
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
    this.parametersSubscription.unsubscribe();
    this.eventSubscription.unsubscribe();
  }

  hasLaps(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((lapsArray, activity) => lapsArray.concat(activity.getLaps()), []).length
  }
}
