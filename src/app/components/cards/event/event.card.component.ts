import {ChangeDetectionStrategy, ChangeDetectorRef, Component, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {Subscription} from 'rxjs';
import {ActivatedRoute, Router} from '@angular/router';
import {EventService} from '../../../services/app.event.service';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {MatSnackBar} from '@angular/material/snack-bar';
import {Log} from 'ng2-logger/browser';
import {AppAuthService} from '../../../authentication/app.auth.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {
  ChartCursorBehaviours,
  ChartThemes,
  XAxisTypes
} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
import {ThemeService} from '../../../services/app.theme.service';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import {MapThemes} from 'quantified-self-lib/lib/users/user.map.settings.interface';
import {UserService} from '../../../services/app.user.service';
import {ActivitySelectionService} from '../../../services/activity-selection-service/activity-selection.service';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  public event: EventInterface;
  public targetUserID: string;
  public currentUser: User;
  public tabIndex;
  public streams: StreamInterface[] = [];
  public selectedActivities: ActivityInterface[] = [];

  public userUnitSettings = UserService.getDefaultUserUnitSettings();
  public showAllData = false;
  public showChartLaps = true;
  public showChartGrid = true;
  public stackChartYAxes = true;
  public useChartAnimations = true;
  public chartDisableGrouping = false;
  public chartHideAllSeriesOnInit = false;
  public chartXAxisType = XAxisTypes.Duration;
  public mapLapTypes = UserService.getDefaultMapLapTypes();
  public chartLapTypes = UserService.getDefaultChartLapTypes();
  public chartStrokeWidth: number = UserService.getDefaultChartStrokeWidth();
  public chartStrokeOpacity: number = UserService.getDefaultChartStrokeOpacity();
  public chartFillOpacity: number = UserService.getDefaultChartFillOpacity();
  public chartExtraMaxForPower: number = UserService.getDefaultExtraMaxForPower();
  public chartGainAndLossThreshold: number = UserService.getDefaultGainAndLossThreshold();
  public chartDataTypesToUse: string[];
  public showMapLaps = true;
  public showMapArrows = true;
  public chartDownSamplingLevel = UserService.getDefaultDownSamplingLevel();
  public chartTheme: ChartThemes;
  public appTheme: AppThemes;
  public mapTheme: MapThemes;
  public mapStrokeWidth: number = UserService.getDefaultMapStrokeWidth();
  public chartCursorBehaviour: ChartCursorBehaviours = UserService.getDefaultChartCursorBehaviour();


  private userSubscription: Subscription;
  private parametersSubscription: Subscription;
  private eventSubscription: Subscription;
  private chartThemeSubscription: Subscription;
  private appThemeSubscription: Subscription;
  private mapThemeSubscription: Subscription;
  private selectedActivitiesSubscription: Subscription;

  private logger = Log.create('EventCardComponent');

  constructor(
    public router: Router,
    private route: ActivatedRoute,
    private authService: AppAuthService,
    private eventService: EventService,
    private activitySelectionService: ActivitySelectionService,
    private snackBar: MatSnackBar,
    private themeService: ThemeService) {
  }

  ngOnChanges() {
  }

  async ngOnInit() {
    // Get the path params
    const userID = this.route.snapshot.paramMap.get('userID');
    const eventID = this.route.snapshot.paramMap.get('eventID');

    // Set a "user from params"
    this.targetUserID = userID;

    this.parametersSubscription = this.route.queryParamMap.subscribe(((queryParams) => {
      this.tabIndex = +queryParams.get('tabIndex');
    }));

    // Subscribe to authService and set the current user if possible
    this.userSubscription = this.authService.user.subscribe((user) => {
      this.currentUser = user;
      if (!this.currentUser) {
        return;
      }
      this.userUnitSettings =  user.settings.unitSettings;
      this.chartXAxisType = user.settings.chartSettings.xAxisType;
      this.chartDownSamplingLevel = user.settings.chartSettings.downSamplingLevel;
      this.chartGainAndLossThreshold = user.settings.chartSettings.gainAndLossThreshold;
      this.chartCursorBehaviour = user.settings.chartSettings.chartCursorBehaviour;
      this.showAllData = user.settings.chartSettings.showAllData;
      this.useChartAnimations = user.settings.chartSettings.useAnimations;
      this.chartDisableGrouping = user.settings.chartSettings.disableGrouping;
      this.showMapLaps = user.settings.mapSettings.showLaps;
      this.showChartLaps = user.settings.chartSettings.showLaps;
      this.showChartGrid = user.settings.chartSettings.showGrid;
      this.stackChartYAxes = user.settings.chartSettings.stackYAxes;
      this.chartHideAllSeriesOnInit = user.settings.chartSettings.hideAllSeriesOnInit;
      this.showMapArrows = user.settings.mapSettings.showArrows;
      this.mapStrokeWidth = user.settings.mapSettings.strokeWidth;
      this.mapLapTypes = user.settings.mapSettings.lapTypes;
      this.chartLapTypes = user.settings.chartSettings.lapTypes;
      this.chartStrokeWidth = user.settings.chartSettings.strokeWidth;
      this.chartStrokeOpacity = user.settings.chartSettings.strokeOpacity;
      this.chartFillOpacity = user.settings.chartSettings.fillOpacity;
      this.chartExtraMaxForPower = user.settings.chartSettings.extraMaxForPower;
      this.chartDataTypesToUse = Object.keys(user.settings.chartSettings.dataTypeSettings).reduce((dataTypesToUse, dataTypeSettingsKey) => {
        if (user.settings.chartSettings.dataTypeSettings[dataTypeSettingsKey].enabled === true) {
          dataTypesToUse.push(dataTypeSettingsKey);
        }
        return dataTypesToUse;
      }, []);
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
    this.eventSubscription = this.eventService.getEventAndActivities(new User(this.targetUserID), eventID).subscribe((event) => {
      if (!event) {
        this.router.navigate(['/dashboard']).then(() => {
          this.snackBar.open('Not found', null, {
            duration: 2000,
          });
        });
        return
      }
      this.event = event;
      this.activitySelectionService.selectedActivities.clear();
      this.activitySelectionService.selectedActivities.select(...event.getActivities());
    });

    // Subscribe to selected activities
    this.selectedActivitiesSubscription = this.activitySelectionService.selectedActivities.changed.asObservable().subscribe((selectedActivities) => {
      this.selectedActivities = selectedActivities.source.selected;
    });
  }


  isOwner() {
    return !!(this.targetUserID && this.currentUser && (this.targetUserID === this.currentUser.uid));
  }

  ngOnDestroy(): void {
    this.userSubscription.unsubscribe();
    this.parametersSubscription.unsubscribe();
    this.eventSubscription.unsubscribe();
    this.chartThemeSubscription.unsubscribe();
    this.appThemeSubscription.unsubscribe();
    this.mapThemeSubscription.unsubscribe();
    this.selectedActivitiesSubscription.unsubscribe();
  }

  hasLaps(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((lapsArray, activity) => lapsArray.concat(activity.getLaps()), []).length
  }

  hasIntensityZones(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((intensityZonesArray, activity) => intensityZonesArray.concat(activity.intensityZones), []).length
  }

  hasDevices(event: EventInterface): boolean {
    return !!this.event.getActivities().reduce((devicesArray, activity) => devicesArray.concat(activity.creator.devices), []).length
  }
}
