import {Component, Input, OnChanges} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {AppAuthService} from '../../authentication/app.auth.service';
import {AppUserService} from '../../services/app.user.service';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {FormControl, FormGroup, Validators} from '@angular/forms';
import * as Sentry from '@sentry/browser';
import {UserSettingsInterface} from '@sports-alliance/sports-lib/lib/users/settings/user.settings.interface';
import {
  ChartCursorBehaviours,
  ChartThemes,
  UserChartSettingsInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';
import {AppThemes, UserAppSettingsInterface} from '@sports-alliance/sports-lib/lib/users/settings/user.app.settings.interface';
import {DynamicDataLoader} from '@sports-alliance/sports-lib/lib/data/data.store';
import {
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  UserUnitSettingsInterface,
  VerticalSpeedUnits
} from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import {UserDashboardSettingsInterface} from '@sports-alliance/sports-lib/lib/users/settings/dashboard/user.dashboard.settings.interface';
import {LapTypesHelper} from '@sports-alliance/sports-lib/lib/laps/lap.types';
import {AngularFireAnalytics} from '@angular/fire/compat/analytics';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import {
  MapThemes,
  MapTypes,
  UserMapSettingsInterface
} from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';

@Component({
  selector: 'app-user-settings',
  templateUrl: './user-settings.component.html',
  styleUrls: ['./user-settings.component.css'],
})
export class UserSettingsComponent implements OnChanges {

  @Input() user: User;
  public isSaving: boolean;
  public errorSaving;
  public xAxisTypes = XAxisTypes;



  public dataGroups = [
    {
      name: 'Basic Data',
      data: DynamicDataLoader.basicDataTypes
    },
    {
      name: 'Advanced Data',
      data: DynamicDataLoader.advancedDataTypes
    },
  ];

  public appThemes = AppThemes;
  public chartThemes = ChartThemes;
  public mapThemes = MapThemes;
  public lapTypes = LapTypesHelper.getLapTypesAsUniqueArray();

  public eventsPerPage = [10, 25, 50, 100, 250,  500, 1000, 2500, 5000];

  public mapTypes = MapTypes;

  public speedUnits = SpeedUnits;
  public verticalSpeedUnits = VerticalSpeedUnits;
  public paceUnits = PaceUnits;
  public swimPaceUnits = SwimPaceUnits;
  public userSettingsFormGroup: FormGroup;

  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();


  constructor(private authService: AppAuthService,
              private route: ActivatedRoute,
              private userService: AppUserService,
              private router: Router,
              private snackBar: MatSnackBar,
              private afa: AngularFireAnalytics,
              private dialog: MatDialog) {
  }

  ngOnChanges(): void {
    // Initialize the user settings and get the enabled ones
    const dataTypesToUse = Object.keys(this.user.settings.chartSettings.dataTypeSettings).filter((dataTypeSettingKey) => {
      return this.user.settings.chartSettings.dataTypeSettings[dataTypeSettingKey].enabled === true;
    });

    this.userSettingsFormGroup = new FormGroup({
      dataTypesToUse: new FormControl(dataTypesToUse, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      appTheme: new FormControl(this.user.settings.appSettings.theme, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartTheme: new FormControl(this.user.settings.chartSettings.theme, [
        Validators.required,
        // Validators.minLength(1),
      ]),
      chartDownSamplingLevel: new FormControl(this.user.settings.chartSettings.downSamplingLevel, [
        Validators.required,
        // Validators.minLength(1),
      ]),
      chartStrokeWidth: new FormControl(this.user.settings.chartSettings.strokeWidth, [
        Validators.required,
        // Validators.minLength(1),
      ]),
      chartGainAndLossThreshold: new FormControl(this.user.settings.chartSettings.gainAndLossThreshold, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartStrokeOpacity: new FormControl(this.user.settings.chartSettings.strokeOpacity, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartExtraMaxForPower: new FormControl(this.user.settings.chartSettings.extraMaxForPower, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartExtraMaxForPace: new FormControl(this.user.settings.chartSettings.extraMaxForPace, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartFillOpacity: new FormControl(this.user.settings.chartSettings.fillOpacity, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartLapTypes: new FormControl(this.user.settings.chartSettings.lapTypes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showChartLaps: new FormControl(this.user.settings.chartSettings.showLaps, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showChartGrid: new FormControl(this.user.settings.chartSettings.showGrid, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      stackYAxes: new FormControl(this.user.settings.chartSettings.stackYAxes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      xAxisType: new FormControl(this.user.settings.chartSettings.xAxisType, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      useAnimations: new FormControl(this.user.settings.chartSettings.useAnimations, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      chartHideAllSeriesOnInit: new FormControl(this.user.settings.chartSettings.hideAllSeriesOnInit, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showAllData: new FormControl(this.user.settings.chartSettings.showAllData, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      chartDisableGrouping: new FormControl(this.user.settings.chartSettings.disableGrouping, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      chartCursorBehaviour: new FormControl(this.user.settings.chartSettings.chartCursorBehaviour === ChartCursorBehaviours.SelectX, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      startOfTheWeek: new FormControl(this.user.settings.unitSettings.startOfTheWeek, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      speedUnitsToUse: new FormControl(this.user.settings.unitSettings.speedUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      paceUnitsToUse: new FormControl(this.user.settings.unitSettings.paceUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      swimPaceUnitsToUse: new FormControl(this.user.settings.unitSettings.swimPaceUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      verticalSpeedUnitsToUse: new FormControl(this.user.settings.unitSettings.verticalSpeedUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      removeAscentForActivitiesSummaries: new FormControl(this.user.settings.summariesSettings.removeAscentForEventTypes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapTheme: new FormControl(this.user.settings.mapSettings.theme, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapType: new FormControl(this.user.settings.mapSettings.mapType, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapStrokeWidth: new FormControl(this.user.settings.mapSettings.strokeWidth, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showMapLaps: new FormControl(this.user.settings.mapSettings.showLaps, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showMapPoints: new FormControl(this.user.settings.mapSettings.showPoints, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showMapArrows: new FormControl(this.user.settings.mapSettings.showArrows, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapLapTypes: new FormControl(this.user.settings.mapSettings.lapTypes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      eventsPerPage: new FormControl(this.user.settings.dashboardSettings.tableSettings.eventsPerPage, [
        Validators.required,
        // Validators.minLength(1),
      ]),

    });
  }

  hasError(field?: string) {
    if (!field) {
      return !this.userSettingsFormGroup.valid;
    }
    return !(this.userSettingsFormGroup.get(field).valid && this.userSettingsFormGroup.get(field).touched);
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.userSettingsFormGroup.valid) {
      this.validateAllFormFields(this.userSettingsFormGroup);
      return;
    }

    this.isSaving = true;
    try {
      const userChartSettings = Array.from(this.userSettingsFormGroup.get('dataTypesToUse').value).reduce((newUserChartSettings: UserChartSettingsInterface, dataTypeToUse: string) => {
        newUserChartSettings.dataTypeSettings[dataTypeToUse] = {enabled: true};
        return newUserChartSettings
      }, {
        dataTypeSettings: {},
        theme: this.userSettingsFormGroup.get('chartTheme').value,
        useAnimations: this.userSettingsFormGroup.get('useAnimations').value,
        xAxisType: this.userSettingsFormGroup.get('xAxisType').value,
        showAllData: this.userSettingsFormGroup.get('showAllData').value,
        chartCursorBehaviour: this.userSettingsFormGroup.get('chartCursorBehaviour').value ? ChartCursorBehaviours.SelectX : ChartCursorBehaviours.ZoomX,
        strokeWidth: this.userSettingsFormGroup.get('chartStrokeWidth').value,
        strokeOpacity: this.userSettingsFormGroup.get('chartStrokeOpacity').value,
        extraMaxForPower: this.userSettingsFormGroup.get('chartExtraMaxForPower').value,
        extraMaxForPace: this.userSettingsFormGroup.get('chartExtraMaxForPace').value,
        fillOpacity: this.userSettingsFormGroup.get('chartFillOpacity').value,
        lapTypes: this.userSettingsFormGroup.get('chartLapTypes').value,
        showLaps: this.userSettingsFormGroup.get('showChartLaps').value,
        showGrid: this.userSettingsFormGroup.get('showChartGrid').value,
        stackYAxes: this.userSettingsFormGroup.get('stackYAxes').value,
        disableGrouping: this.userSettingsFormGroup.get('chartDisableGrouping').value,
        hideAllSeriesOnInit: this.userSettingsFormGroup.get('chartHideAllSeriesOnInit').value,
        gainAndLossThreshold: this.userSettingsFormGroup.get('chartGainAndLossThreshold').value,
        downSamplingLevel: this.userSettingsFormGroup.get('chartDownSamplingLevel').value,
      });

      await this.userService.updateUserProperties(this.user, {
        settings: <UserSettingsInterface>{
          chartSettings: userChartSettings,
          appSettings: <UserAppSettingsInterface>{theme: this.userSettingsFormGroup.get('appTheme').value},
          mapSettings: <UserMapSettingsInterface>{
            theme: this.userSettingsFormGroup.get('mapTheme').value,
            showLaps: this.userSettingsFormGroup.get('showMapLaps').value,
            showPoints: this.userSettingsFormGroup.get('showMapPoints').value,
            showArrows: this.userSettingsFormGroup.get('showMapArrows').value,
            lapTypes: this.userSettingsFormGroup.get('mapLapTypes').value,
            mapType: this.userSettingsFormGroup.get('mapType').value,
            strokeWidth: this.userSettingsFormGroup.get('mapStrokeWidth').value
          },
          unitSettings: <UserUnitSettingsInterface>{
            speedUnits: this.userSettingsFormGroup.get('speedUnitsToUse').value,
            gradeAdjustedSpeedUnits: AppUserService.getGradeAdjustedSpeedUnitsFromSpeedUnits(this.userSettingsFormGroup.get('speedUnitsToUse').value),
            paceUnits: this.userSettingsFormGroup.get('paceUnitsToUse').value,
            gradeAdjustedPaceUnits: AppUserService.getGradeAdjustedPaceUnitsFromPaceUnits(this.userSettingsFormGroup.get('paceUnitsToUse').value),
            swimPaceUnits: this.userSettingsFormGroup.get('swimPaceUnitsToUse').value,
            verticalSpeedUnits: this.userSettingsFormGroup.get('verticalSpeedUnitsToUse').value,
            startOfTheWeek: this.userSettingsFormGroup.get('startOfTheWeek').value,
          },
          dashboardSettings: <UserDashboardSettingsInterface>{
            tiles: this.user.settings.dashboardSettings.tiles,
            startDate: this.user.settings.dashboardSettings.startDate,
            endDate: this.user.settings.dashboardSettings.endDate,
            dateRange: this.user.settings.dashboardSettings.dateRange,
            tableSettings: {
              active: this.user.settings.dashboardSettings.tableSettings.active,
              direction: this.user.settings.dashboardSettings.tableSettings.direction,
              eventsPerPage: this.userSettingsFormGroup.get('eventsPerPage').value
            }
          },
          summariesSettings: {
            removeAscentForEventTypes:  this.userSettingsFormGroup.get('removeAscentForActivitiesSummaries').value
          },
          exportToCSVSettings: this.user.settings.exportToCSVSettings
        }
      });
      this.snackBar.open('User updated', null, {
        duration: 2000,
      });
      this.afa.logEvent('user_settings_update');
    } catch (e) {

      this.snackBar.open('Could not update user', null, {
        duration: 2000,
      });
      Sentry.captureException(e);
      // @todo add logging
    } finally {
      this.isSaving = false;
    }
  }

  validateAllFormFields(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof FormControl) {
        control.markAsTouched({onlySelf: true});
      } else if (control instanceof FormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }
}
