import {Component, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {Subscription} from 'rxjs';
import {ActivatedRoute, Router} from '@angular/router';
import {EventColorService} from '../../../services/color/app.event.color.service';
import {EventService} from '../../../services/app.event.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {UserSettingsService} from '../../../services/app.user.settings.service';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {MatSnackBar} from '@angular/material/snack-bar';
import {Log} from 'ng2-logger/browser';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {AppAuthService} from '../../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {ChartThemes, XAxisTypes} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {ThemeService} from '../../../services/app.theme.service';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {MapThemes} from 'quantified-self-lib/lib/users/user.map.settings.interface';


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

  public showAllData: boolean;
  public chartXAxisType = XAxisTypes.Duration;
  public showMapLaps;
  public showMapArrows;
  public dataSmoothingLevel = 3;
  public chartTheme: ChartThemes;
  public appTheme: AppThemes;
  public mapTheme: MapThemes;

  private userSubscription: Subscription;
  private parametersSubscription: Subscription;
  private eventSubscription: Subscription;
  private chartThemeSubscription: Subscription;
  private appThemeSubscription: Subscription;
  private mapThemeSubscription: Subscription;

  private logger = Log.create('EventCardComponent');

  constructor(
    public router: Router,
    private route: ActivatedRoute,
    private authService: AppAuthService,
    private eventService: EventService,
    private userSettingsService: UserSettingsService,
    private snackBar: MatSnackBar,
    private themeService: ThemeService) {
  }

  ngOnChanges() {
  }

  async ngOnInit() {
    // Get the settings
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
      if (!this.currentUser) {
        return;
      }
      this.chartXAxisType = user.settings.chartSettings.xAxisType;
      this.dataSmoothingLevel = user.settings.chartSettings.dataSmoothingLevel;
      this.showAllData = user.settings.chartSettings.showAllData;
      this.showMapLaps = user.settings.mapSettings.showLaps;
      this.showMapArrows = user.settings.mapSettings.showArrows;
    });

    // Subscribe to the chartTheme changes
    this.chartThemeSubscription = this.themeService.getChartTheme().subscribe((chartTheme) => {
      this.chartTheme = chartTheme;
    });

    // Subscribe to the appTheme changes
    this.appThemeSubscription = this.themeService.getAppTheme().subscribe((appTheme) => {
      this.appTheme = appTheme;
    });

    // Subscribe to the appTheme changes
    this.mapThemeSubscription = this.themeService.getMapTheme().subscribe((mapTheme) => {
      this.mapTheme = mapTheme;
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
    return this.eventService.setEventPrivacy(this.currentUser, this.event.getID(), this.event.privacy === Privacy.Private ? Privacy.Public : Privacy.Private);
  }

  isOwner() {
    return !!(this.targetUser && this.currentUser && (this.targetUser.uid === this.currentUser.uid));
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
    this.parametersSubscription.unsubscribe();
    this.eventSubscription.unsubscribe();
    this.chartThemeSubscription.unsubscribe();
    this.appThemeSubscription.unsubscribe();
    this.mapThemeSubscription.unsubscribe();
  }

  hasLaps(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((lapsArray, activity) => lapsArray.concat(activity.getLaps()), []).length
  }
  hasDevices(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((devicesArray, activity) => devicesArray.concat(activity.creator.devices), []).length
  }
}
