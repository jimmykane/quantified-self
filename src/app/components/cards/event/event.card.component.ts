import {Component, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {EMPTY, Subscription} from 'rxjs';
import {ActivatedRoute, ParamMap, Router} from '@angular/router';
import {EventColorService} from '../../../services/color/app.event.color.service';
import {EventService} from '../../../services/app.event.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {UserSettingsService} from '../../../services/app.user.settings.service';
import {map, mergeMap, switchMap} from 'rxjs/operators';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {MatSnackBar} from '@angular/material';
import {Log} from 'ng2-logger/browser';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {AppAuthService} from '../../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  public event: EventInterface;
  public targetUser: User;
  public currentUser: User;
  public tabIndex;
  public streams: StreamInterface[] = [];
  public selectedActivities: ActivityInterface[] = [];

  public showMapAutoLaps: boolean;
  public showMapManualLaps: boolean;
  public showAllData: boolean;
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
    public eventColorService: EventColorService) {
  }

  ngOnChanges() {
    // debugger;
  }

  async ngOnInit() {
    // Get the settings
    this.userSettingsService.showAutoLaps().then(value => this.showMapAutoLaps = value);
    this.userSettingsService.showManualLaps().then(value => this.showMapManualLaps = value);
    this.userSettingsService.useDistanceAxis().then(value => this.useDistanceAxis = value);
    this.userSettingsService.showAllData().then(value => this.showAllData = value);

    // Get the path params
    const userID = this.route.snapshot.paramMap.get('userID');
    const eventID = this.route.snapshot.paramMap.get('eventID');

    // Set a "user from params"
    this.targetUser = new User(userID);

    this.parametersSubscription = this.route.queryParamMap.subscribe(((queryParams) => {
      this.tabIndex = +queryParams.get('tabIndex');
    }));

    // Subscribe to authService and set the current user if possible
    this.userSubscription = this.authService.user.subscribe((user) => {
      this.currentUser = user;
    });

    // Subscribe to the actual subject our event
    this.eventSubscription = this.eventService.getEventAndActivities(this.targetUser, eventID).subscribe((event) => {
      if (!event) {
        this.router.navigate(['/dashboard']).then(() => {
          this.snackBar.open('Not found', null, {
            duration: 2000,
          });
        });
        return
      }
      this.event = event;
      this.selectedActivities = event.getActivities();
    });
  }

  async toggleEventPrivacy() {
    return this.eventService.setEventPrivacy(this.currentUser, this.event.getID(), this.event.privacy === Privacy.private ? Privacy.public : Privacy.private);
  }

  isOwner() {
    return !!(this.targetUser && this.currentUser && (this.targetUser.uid === this.currentUser.uid));
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
