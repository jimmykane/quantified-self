import {Component, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {EMPTY, Subscription} from 'rxjs';
import {ActivatedRoute, Router} from '@angular/router';
import {AppEventColorService} from '../../../services/color/app.event.color.service';
import {EventService} from '../../../services/app.event.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {UserSettingsService} from '../../../services/app.user.settings.service';
import {map, mergeMap} from 'rxjs/operators';
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
  public selectedTabIndex;
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
    this.userSettingsService.getShowAutoLaps().then(value => this.showMapAutoLaps = value);
    this.userSettingsService.getShowManualLaps().then(value => this.showMapManualLaps = value);
    this.userSettingsService.getShowData().then(value => this.showData = value);
    this.userSettingsService.showDataWarnings().then(value => this.showMapDataWarnings = value);
    this.userSettingsService.useDistanceAxis().then(value => this.useDistanceAxis = value);
    this.userSettingsService.showAdvancedStats().then(value => this.showAdvancedStats = value);


    // Subscribe to authService and set the current user if possible
    this.userSubscription = this.authService.user.subscribe((user) => {
      this.user = user;
    });

    // @todo test maps , switchmap etc with delete and order firing etc
    this.parametersSubscription = this.route.queryParams.pipe(mergeMap((params) => {
      // First check if it's base 64
      let eventID: string;
      let userID: string;
      let tabIndex: number;
      try {
        // @todo move to service and user LZ
        const urlParams = new URLSearchParams(atob(params['shareID']));
        eventID = urlParams.get('eventID');
        userID = urlParams.get('userID');
        tabIndex = +urlParams.get('tabIndex');
      } catch (e) {
        userID = params['userID'];
        eventID = params['eventID'];
        this.selectedTabIndex = +params['tabIndex']; // we dont care about the tab index , default it to 0
        debugger;
      }
      if (!userID || !eventID) {
        this.router.navigate(['/dashboard']);
        this.snackBar.open('Incorrect url', null, {
          duration: 5000,
        });
        return
      }

      this.userFromParams = {uid: userID};
      // / debugger;
      // If the current event is the same then return empty !important
      if (this.event && this.event.getID() === eventID) {
        return EMPTY
      }
      // debugger;
      // Create a phony user and try to get the event
      return this.eventService.getEventAndActivities(this.userFromParams, eventID);
    })).pipe(map((event) => {
      if (!event) {
        this.router.navigate(['/dashboard']);
        this.snackBar.open('Not found', null, {
          duration: 5000,
        });
        return
      }
      this.event = event;
      this.selectedActivities = event.getActivities();
    })).subscribe()
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
  }

  hasLaps(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((lapsArray, activity) => lapsArray.concat(activity.getLaps()), []).length
  }
}
