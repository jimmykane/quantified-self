import { Component, Input, OnChanges, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { User } from '@sports-alliance/sports-lib';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppPaymentService } from '../../services/app.payment.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import * as Sentry from '@sentry/browser';
import { UserSettingsInterface } from '@sports-alliance/sports-lib';
import {
  ChartCursorBehaviours,
  ChartThemes,
  UserChartSettingsInterface,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { AppThemes, UserAppSettingsInterface } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import {
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  UserUnitSettingsInterface,
  VerticalSpeedUnits
} from '@sports-alliance/sports-lib';
import { UserDashboardSettingsInterface } from '@sports-alliance/sports-lib';
import { LapTypesHelper } from '@sports-alliance/sports-lib';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import {
  MapThemes,
  MapTypes,
  UserMapSettingsInterface
} from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-user-settings',
  templateUrl: './user-settings.component.html',
  styleUrls: ['./user-settings.component.css'],
  standalone: false
})
export class UserSettingsComponent implements OnChanges {

  @Input() user: User;
  public isSaving: boolean;
  public errorSaving;
  public isManagingSubscription = false;
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

  public eventsPerPage = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

  public mapTypes = MapTypes;

  public speedUnits = SpeedUnits;
  public verticalSpeedUnits = VerticalSpeedUnits;
  public paceUnits = PaceUnits;
  public swimPaceUnits = SwimPaceUnits;
  public userSettingsFormGroup: UntypedFormGroup;

  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();
  private analytics = inject(Analytics);
  private paymentService = inject(AppPaymentService);


  constructor(private authService: AppAuthService,
    private route: ActivatedRoute,
    private userService: AppUserService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog) {
  }

  async manageSubscription(): Promise<void> {
    this.isManagingSubscription = true;
    try {
      await this.paymentService.manageSubscriptions();
    } catch (error) {
      console.error('Error opening customer portal:', error);
      this.snackBar.open('Could not open subscription management. Please try again.', null, {
        duration: 3000,
      });
      Sentry.captureException(error);
    } finally {
      this.isManagingSubscription = false;
    }
  }

  ngOnChanges(): void {
    // Initialize the user settings and get the enabled ones
    const dataTypesToUse = Object.keys(this.user.settings.chartSettings.dataTypeSettings).filter((dataTypeSettingKey) => {
      return this.user.settings.chartSettings.dataTypeSettings[dataTypeSettingKey].enabled === true;
    });

    this.userSettingsFormGroup = new UntypedFormGroup({
      dataTypesToUse: new UntypedFormControl(dataTypesToUse, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      appTheme: new UntypedFormControl(this.user.settings.appSettings.theme, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartTheme: new UntypedFormControl(this.user.settings.chartSettings.theme, [
        Validators.required,
        // Validators.minLength(1),
      ]),
      chartDownSamplingLevel: new UntypedFormControl(this.user.settings.chartSettings.downSamplingLevel, [
        Validators.required,
        // Validators.minLength(1),
      ]),
      chartStrokeWidth: new UntypedFormControl(this.user.settings.chartSettings.strokeWidth, [
        Validators.required,
        // Validators.minLength(1),
      ]),
      chartGainAndLossThreshold: new UntypedFormControl(this.user.settings.chartSettings.gainAndLossThreshold, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartStrokeOpacity: new UntypedFormControl(this.user.settings.chartSettings.strokeOpacity, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartExtraMaxForPower: new UntypedFormControl(this.user.settings.chartSettings.extraMaxForPower, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartExtraMaxForPace: new UntypedFormControl(this.user.settings.chartSettings.extraMaxForPace, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartFillOpacity: new UntypedFormControl(this.user.settings.chartSettings.fillOpacity, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      chartLapTypes: new UntypedFormControl(this.user.settings.chartSettings.lapTypes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showChartLaps: new UntypedFormControl(this.user.settings.chartSettings.showLaps, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showChartGrid: new UntypedFormControl(this.user.settings.chartSettings.showGrid, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      stackYAxes: new UntypedFormControl(this.user.settings.chartSettings.stackYAxes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      xAxisType: new UntypedFormControl(this.user.settings.chartSettings.xAxisType, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      useAnimations: new UntypedFormControl(this.user.settings.chartSettings.useAnimations, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      chartHideAllSeriesOnInit: new UntypedFormControl(this.user.settings.chartSettings.hideAllSeriesOnInit, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showAllData: new UntypedFormControl(this.user.settings.chartSettings.showAllData, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      chartDisableGrouping: new UntypedFormControl(this.user.settings.chartSettings.disableGrouping, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      chartCursorBehaviour: new UntypedFormControl(this.user.settings.chartSettings.chartCursorBehaviour === ChartCursorBehaviours.SelectX, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      startOfTheWeek: new UntypedFormControl(this.user.settings.unitSettings.startOfTheWeek, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      speedUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.speedUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      paceUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.paceUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      swimPaceUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.swimPaceUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      verticalSpeedUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.verticalSpeedUnits, [
        Validators.required,
        // Validators.minLength(1),
      ]),

      removeAscentForActivitiesSummaries: new UntypedFormControl(this.user.settings.summariesSettings.removeAscentForEventTypes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapTheme: new UntypedFormControl(this.user.settings.mapSettings.theme, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapType: new UntypedFormControl(this.user.settings.mapSettings.mapType, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapStrokeWidth: new UntypedFormControl(this.user.settings.mapSettings.strokeWidth, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showMapLaps: new UntypedFormControl(this.user.settings.mapSettings.showLaps, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showMapPoints: new UntypedFormControl(this.user.settings.mapSettings.showPoints, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      showMapArrows: new UntypedFormControl(this.user.settings.mapSettings.showArrows, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      mapLapTypes: new UntypedFormControl(this.user.settings.mapSettings.lapTypes, [
        // Validators.required,
        // Validators.minLength(1),
      ]),

      eventsPerPage: new UntypedFormControl(this.user.settings.dashboardSettings.tableSettings.eventsPerPage, [
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
        newUserChartSettings.dataTypeSettings[dataTypeToUse] = { enabled: true };
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
          appSettings: <UserAppSettingsInterface>{ theme: this.userSettingsFormGroup.get('appTheme').value },
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
            removeAscentForEventTypes: this.userSettingsFormGroup.get('removeAscentForActivitiesSummaries').value
          },
          exportToCSVSettings: this.user.settings.exportToCSVSettings
        }
      });
      this.snackBar.open('User updated', null, {
        duration: 2000,
      });
      logEvent(this.analytics, 'user_settings_update');
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

  validateAllFormFields(formGroup: UntypedFormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof UntypedFormControl) {
        control.markAsTouched({ onlySelf: true });
      } else if (control instanceof UntypedFormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }
}
