import { Component, Input, OnChanges, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AppWindowService } from '../../services/app.window.service';
import { AppUserInterface } from '../../models/app-user.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';

import { MatDialog } from '@angular/material/dialog';
import { DeleteAccountDialogComponent } from '../delete-account-dialog/delete-account-dialog.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { LoggerService } from '../../services/logger.service';
import { Privacy, UserSettingsInterface } from '@sports-alliance/sports-lib';
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
import { UserDashboardSettingsInterface, ACTIVITIES_EXCLUDED_FROM_ASCENT, ACTIVITIES_EXCLUDED_FROM_DESCENT } from '@sports-alliance/sports-lib';
import { LapTypesHelper } from '@sports-alliance/sports-lib';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import {
  MapTypes,
  UserMapSettingsInterface
} from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-user-settings',
  templateUrl: './user-settings.component.html',
  styleUrls: ['./user-settings.component.scss'],
  standalone: false
})
export class UserSettingsComponent implements OnChanges {

  public mandatoryAscentExclusions = ACTIVITIES_EXCLUDED_FROM_ASCENT;
  public mandatoryDescentExclusions = ACTIVITIES_EXCLUDED_FROM_DESCENT;

  @Input() user: AppUserInterface;
  public privacy = Privacy;
  public isSaving: boolean;
  public isDeleting: boolean;
  public consentToDelete: boolean;
  public errorDeleting;
  public errorSaving;
  public activeSection: 'profile' | 'app' | 'dashboard' | 'map' | 'charts' | 'units' = 'profile';

  public xAxisTypes = XAxisTypes;



  public dataGroups = [
    {
      name: 'Basic Data',
      data: DynamicDataLoader.basicDataTypes
    },
    {
      name: 'Advanced Data',
      data: DynamicDataLoader.advancedDataTypes.filter(type => !DynamicDataLoader.basicDataTypes.includes(type))
    },
  ];

  public appThemes = AppThemes;
  public chartThemes = ChartThemes;
  public lapTypes = LapTypesHelper.getLapTypesAsUniqueArray();

  public eventsPerPage = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

  public mapTypes = MapTypes;

  public speedUnits = SpeedUnits;
  public verticalSpeedUnits = VerticalSpeedUnits;
  public paceUnits = PaceUnits;
  public swimPaceUnits = SwimPaceUnits;
  public userSettingsFormGroup: UntypedFormGroup;

  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();
  private analyticsService = inject(AppAnalyticsService);



  public isAdminUser = false;

  get isProUser(): boolean {
    return AppUserService.isProUser(this.user, this.isAdminUser);
  }

  get isBasicUser(): boolean {
    return AppUserService.isBasicUser(this.user);
  }

  get userAvatarUrl(): string {
    if (this.user?.photoURL) {
      return this.user.photoURL;
    }
    const name = this.user?.displayName || 'Guest';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
  }

  constructor(private authService: AppAuthService,
    private route: ActivatedRoute,
    private userService: AppUserService,
    private router: Router,
    private snackBar: MatSnackBar,
    private windowService: AppWindowService,
    private dialog: MatDialog,
    private logger: LoggerService) {
  }



  ngOnChanges(): void {
    if (this.user) {
      this.userService.isAdmin().then(isAdmin => this.isAdminUser = isAdmin);
    }
    // Initialize the user settings and get the enabled ones
    const dataTypesToUse = Object.keys(this.user.settings.chartSettings.dataTypeSettings).filter((dataTypeSettingKey) => {
      return this.user.settings.chartSettings.dataTypeSettings[dataTypeSettingKey].enabled === true;
    });

    this.userSettingsFormGroup = new UntypedFormGroup({
      displayName: new UntypedFormControl(this.user.displayName, [
        Validators.required,
      ]),
      privacy: new UntypedFormControl(this.user.privacy || Privacy.Private, [
        Validators.required,
      ]),
      description: new UntypedFormControl(this.user.description, []),
      dataTypesToUse: new UntypedFormControl(dataTypesToUse, [
        Validators.required,
      ]),
      appTheme: new UntypedFormControl(this.user.settings.appSettings.theme, [
        Validators.required,
      ]),
      acceptedTrackingPolicy: new UntypedFormControl(this.user.acceptedTrackingPolicy, []),
      acceptedMarketingPolicy: new UntypedFormControl(this.user.acceptedMarketingPolicy || false, []),
      chartTheme: new UntypedFormControl(this.user.settings.chartSettings.theme, [
        Validators.required,
      ]),
      chartDownSamplingLevel: new UntypedFormControl(this.user.settings.chartSettings.downSamplingLevel, [
        Validators.required,
      ]),
      chartStrokeWidth: new UntypedFormControl(this.user.settings.chartSettings.strokeWidth, [
        Validators.required,
      ]),
      chartGainAndLossThreshold: new UntypedFormControl(this.user.settings.chartSettings.gainAndLossThreshold, [
        Validators.required,
      ]),
      chartStrokeOpacity: new UntypedFormControl(this.user.settings.chartSettings.strokeOpacity, [
        Validators.required,
      ]),
      chartExtraMaxForPower: new UntypedFormControl(this.user.settings.chartSettings.extraMaxForPower, [
        Validators.required,
      ]),
      chartExtraMaxForPace: new UntypedFormControl(this.user.settings.chartSettings.extraMaxForPace, [
        Validators.required,
      ]),
      chartFillOpacity: new UntypedFormControl(this.user.settings.chartSettings.fillOpacity, [
        Validators.required,
      ]),
      chartLapTypes: new UntypedFormControl(this.user.settings.chartSettings.lapTypes, []),
      showChartLaps: new UntypedFormControl(this.user.settings.chartSettings.showLaps, []),
      showChartGrid: new UntypedFormControl(this.user.settings.chartSettings.showGrid, []),
      stackYAxes: new UntypedFormControl(this.user.settings.chartSettings.stackYAxes, []),
      xAxisType: new UntypedFormControl(this.user.settings.chartSettings.xAxisType, [
        Validators.required,
      ]),
      useAnimations: new UntypedFormControl(this.user.settings.chartSettings.useAnimations, []),
      chartHideAllSeriesOnInit: new UntypedFormControl(this.user.settings.chartSettings.hideAllSeriesOnInit, []),
      showAllData: new UntypedFormControl(this.user.settings.chartSettings.showAllData, []),
      chartDisableGrouping: new UntypedFormControl(this.user.settings.chartSettings.disableGrouping, []),
      removeAscentForActivitiesSummaries: new UntypedFormControl([...new Set([...(this.user.settings.summariesSettings?.removeAscentForEventTypes || []), ...this.mandatoryAscentExclusions])], []),
      removeDescentForActivitiesSummaries: new UntypedFormControl([...new Set([...((this.user.settings.summariesSettings as any)?.removeDescentForEventTypes || []), ...this.mandatoryDescentExclusions])], []),
      chartCursorBehaviour: new UntypedFormControl(this.user.settings.chartSettings.chartCursorBehaviour === ChartCursorBehaviours.SelectX, []),
      startOfTheWeek: new UntypedFormControl(this.user.settings.unitSettings.startOfTheWeek, [
        Validators.required,
      ]),
      speedUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.speedUnits, [
        Validators.required,
      ]),
      paceUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.paceUnits, [
        Validators.required,
      ]),
      swimPaceUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.swimPaceUnits, [
        Validators.required,
      ]),
      verticalSpeedUnitsToUse: new UntypedFormControl(this.user.settings.unitSettings.verticalSpeedUnits, [
        Validators.required,
      ]),
      mapType: new UntypedFormControl(this.user.settings.mapSettings.mapType, []),
      mapStrokeWidth: new UntypedFormControl(this.user.settings.mapSettings.strokeWidth, []),
      showMapLaps: new UntypedFormControl(this.user.settings.mapSettings.showLaps, []),
      showMapArrows: new UntypedFormControl(this.user.settings.mapSettings.showArrows, []),
      mapLapTypes: new UntypedFormControl(this.user.settings.mapSettings.lapTypes, []),
      eventsPerPage: new UntypedFormControl(this.user.settings.dashboardSettings.tableSettings.eventsPerPage, [
        Validators.required,
      ]),
    });
  }

  hasError(field?: string) {
    if (!field) {
      return !this.userSettingsFormGroup.valid;
    }
    return !(this.userSettingsFormGroup.get(field).valid && this.userSettingsFormGroup.get(field).touched);
  }

  isMandatoryExclusion(type: any): boolean {
    return this.mandatoryAscentExclusions.indexOf(type) >= 0;
  }

  isMandatoryDescentExclusion(type: any): boolean {
    return this.mandatoryDescentExclusions.indexOf(type) >= 0;
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.userSettingsFormGroup.valid) {
      this.validateAllFormFields(this.userSettingsFormGroup);
      return;
    }

    this.isSaving = true;
    try {
      const dataTypesToUseValue = this.userSettingsFormGroup.get('dataTypesToUse').value as string[];

      // Get all available data types from both groups
      const allDataTypes = [...DynamicDataLoader.basicDataTypes, ...DynamicDataLoader.advancedDataTypes];
      // Create a Set for O(1) lookup of selected types
      const selectedTypesSet = new Set(dataTypesToUseValue);

      // Build dataTypeSettings with enabled: true for selected, enabled: false for unselected
      const dataTypeSettings: { [key: string]: { enabled: boolean } } = {};
      for (const dataType of allDataTypes) {
        dataTypeSettings[dataType] = { enabled: selectedTypesSet.has(dataType) };
      }

      const userChartSettings: UserChartSettingsInterface = {
        dataTypeSettings: dataTypeSettings,
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
      };

      await this.userService.updateUserProperties(this.user, {
        displayName: this.userSettingsFormGroup.get('displayName').value,
        privacy: this.userSettingsFormGroup.get('privacy').value,
        description: this.userSettingsFormGroup.get('description').value,
        acceptedTrackingPolicy: this.userSettingsFormGroup.get('acceptedTrackingPolicy').value,
        acceptedMarketingPolicy: this.userSettingsFormGroup.get('acceptedMarketingPolicy').value,
        settings: <UserSettingsInterface>{
          chartSettings: userChartSettings,
          appSettings: <UserAppSettingsInterface>{ theme: this.userSettingsFormGroup.get('appTheme').value },
          mapSettings: <UserMapSettingsInterface>{
            showLaps: this.userSettingsFormGroup.get('showMapLaps').value,

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
            removeAscentForEventTypes: this.userSettingsFormGroup.get('removeAscentForActivitiesSummaries').value,
            removeDescentForEventTypes: this.userSettingsFormGroup.get('removeDescentForActivitiesSummaries').value
          },
          exportToCSVSettings: this.user.settings.exportToCSVSettings
        }
      });
      this.snackBar.open('User updated', undefined, {
        duration: 2000,
      });
      this.analyticsService.logEvent('user_settings_update');
    } catch (e) {
      this.logger.error('[UserSettingsComponent] onSubmit FAILED. Error details:', e);
      this.snackBar.open('Could not update user', undefined, {
        duration: 2000,
      });
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

  public deleteUser(event: Event) {
    event.preventDefault();

    // Check if user has an active paid subscription
    const stripeRole = (this.user as any).stripeRole;
    const hasActiveSubscription = stripeRole === 'pro' || stripeRole === 'basic';

    const dialogRef = this.dialog.open(DeleteAccountDialogComponent, {
      data: {
        displayName: this.user.displayName,
        hasActiveSubscription
      }
    });

    dialogRef.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) {
        return;
      }

      this.isDeleting = true;
      try {
        await this.userService.deleteAllUserData(this.user);
        this.analyticsService.logEvent('user_delete', {});
        await this.authService.signOut();
        await this.router.navigate(['/']);
        this.snackBar.open('Account deleted! You are now logged out.', undefined, {
          duration: 5000,
        });
        localStorage.clear();
        this.windowService.windowRef.location.reload();
      } catch (e) {
        this.logger.error(e);
        this.errorDeleting = e;
        this.isDeleting = false;
      }
    });
  }
}
