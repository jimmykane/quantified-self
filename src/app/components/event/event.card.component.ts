import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';

import { ActivityInterface } from '@sports-alliance/sports-lib';
import { EventInterface } from '@sports-alliance/sports-lib';
import { StreamInterface } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppAuthService } from '../../authentication/app.auth.service';
import { User } from '@sports-alliance/sports-lib';
import {
  ChartCursorBehaviours,
  ChartThemes,
  XAxisTypes
} from '@sports-alliance/sports-lib';
import { AppThemeService } from '../../services/app.theme.service';
import { AppThemes } from '@sports-alliance/sports-lib';
import { MapThemes } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { AppActivitySelectionService } from '../../services/activity-selection-service/app-activity-selection.service';


import { ActivityTypesHelper } from '@sports-alliance/sports-lib';


@Component({
  selector: 'app-event-card',
  templateUrl: './event.card.component.html',
  styleUrls: ['./event.card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardComponent implements OnInit, OnDestroy, OnChanges {
  public event: EventInterface;
  public targetUserID: string;
  public currentUser: User;
  public selectedActivities: ActivityInterface[] = [];

  public userUnitSettings = AppUserService.getDefaultUserUnitSettings();
  public showAllData = false;
  public showChartLaps = true;
  public showChartGrid = true;
  public stackChartYAxes = true;
  public useChartAnimations = false;
  public chartDisableGrouping = false;
  public chartHideAllSeriesOnInit = false;
  public chartXAxisType = XAxisTypes.Duration;
  public mapLapTypes = AppUserService.getDefaultMapLapTypes();
  public chartLapTypes = AppUserService.getDefaultChartLapTypes();
  public chartStrokeWidth: number = AppUserService.getDefaultChartStrokeWidth();
  public chartStrokeOpacity: number = AppUserService.getDefaultChartStrokeOpacity();
  public chartFillOpacity: number = AppUserService.getDefaultChartFillOpacity();
  public chartExtraMaxForPower: number = AppUserService.getDefaultExtraMaxForPower();
  public chartExtraMaxForPace: number = AppUserService.getDefaultExtraMaxForPace();
  public chartGainAndLossThreshold: number = AppUserService.getDefaultGainAndLossThreshold();
  public chartDataTypesToUse: string[];
  public showMapLaps = true;
  public showMapPoints = false;
  public showMapArrows = true;
  public chartDownSamplingLevel = AppUserService.getDefaultDownSamplingLevel();
  public chartTheme: ChartThemes;
  public appTheme: AppThemes;
  public mapTheme: MapThemes;
  public mapStrokeWidth: number = AppUserService.getDefaultMapStrokeWidth();
  public chartCursorBehaviour: ChartCursorBehaviours = AppUserService.getDefaultChartCursorBehaviour();

  public basicStatsTypes = [
    'Duration',
    'Distance',
    'SpeedMean',
    'HeartRateMean',
    'PowerMean',
    'Ascent',
    'Calories'
  ];


  private subscriptions: Subscription[] = [];



  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    public router: Router,
    private route: ActivatedRoute,
    private authService: AppAuthService,
    private userService: AppUserService,
    private activitySelectionService: AppActivitySelectionService,
    private snackBar: MatSnackBar,
    private themeService: AppThemeService) {
  }

  ngOnChanges() {
  }

  async ngOnInit() {
    // Subscribe to selected activities
    this.subscriptions.push(this.activitySelectionService.selectedActivities.changed.asObservable().subscribe((selectedActivities) => {
      this.selectedActivities = selectedActivities.source.selected;
      this.changeDetectorRef.detectChanges();
    }));

    this.subscriptions.push(this.route.data.subscribe((data: { event: EventInterface }) => {
      this.event = data.event;
      this.activitySelectionService.selectedActivities.clear();
      this.activitySelectionService.selectedActivities.select(...this.event.getActivities());
      // Fallback/Initial set
      this.selectedActivities = this.event.getActivities();

      this.targetUserID = this.route.snapshot.paramMap.get('userID');
      console.log('[EventCardComponent] Initialized.', {
        event: this.event,
        activities: this.event.getActivities().length,
        hasPositions: this.hasPositions(this.event),
        targetUserID: this.targetUserID,
        selectedActivities: this.selectedActivities.length
      });
      this.changeDetectorRef.detectChanges();
    }));

    this.subscriptions.push(this.authService.user$.subscribe((user: User | null) => {
      this.currentUser = user;
      if (this.currentUser) {
        const user = this.currentUser;
        this.userUnitSettings = user.settings.unitSettings;
        this.chartXAxisType = user.settings.chartSettings.xAxisType;
        this.chartDownSamplingLevel = user.settings.chartSettings.downSamplingLevel;
        this.chartGainAndLossThreshold = user.settings.chartSettings.gainAndLossThreshold;
        this.chartCursorBehaviour = user.settings.chartSettings.chartCursorBehaviour;
        this.showAllData = user.settings.chartSettings.showAllData;
        this.useChartAnimations = user.settings.chartSettings.useAnimations;
        this.chartDisableGrouping = user.settings.chartSettings.disableGrouping;
        this.showMapLaps = user.settings.mapSettings.showLaps;
        this.showMapPoints = user.settings.mapSettings.showPoints;
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
        this.chartExtraMaxForPace = user.settings.chartSettings.extraMaxForPace;
        this.chartDataTypesToUse = this.userService.getUserChartDataTypesToUse(user);
      }
      this.changeDetectorRef.detectChanges();
    }));

    // Subscribe to the chartTheme changes
    this.subscriptions.push(this.themeService.getChartTheme().subscribe((chartTheme) => {
      this.chartTheme = chartTheme;
      this.changeDetectorRef.detectChanges();
    }));

    // Subscribe to the appTheme changes
    this.subscriptions.push(this.themeService.getAppTheme().subscribe((appTheme) => {
      this.appTheme = appTheme;
      this.changeDetectorRef.detectChanges();
    }));

    // Subscribe to the appTheme changes
    this.subscriptions.push(this.themeService.getMapTheme().subscribe((mapTheme) => {
      this.mapTheme = mapTheme;
      this.changeDetectorRef.detectChanges();
    }));


  }


  isOwner() {
    return !!(this.targetUserID && this.currentUser && (this.targetUserID === this.currentUser.uid));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => {
      if (subscription) {
        subscription.unsubscribe()
      }
    })
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

  hasPositions(event: EventInterface): boolean {
    return !!this.event.getActivities().filter(a => a.hasPositionData()).length
  }
}
