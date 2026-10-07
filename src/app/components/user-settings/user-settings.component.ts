import { Component, Input, OnChanges, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AppWindowService } from '../../services/app.window.service';
import { AppAppSettingsInterface, AppChartSettingsInterface, AppUserInterface, AppUserSettingsInterface } from '../../models/app-user.interface';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppUserUtilities } from '../../utils/app.user.utilities';

import { MatDialog } from '@angular/material/dialog';
import { DeleteAccountDialogComponent } from '../delete-account-dialog/delete-account-dialog.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AbstractControl, UntypedFormControl, UntypedFormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { LoggerService } from '../../services/logger.service';
import { User, UserSettingsInterface } from '@sports-alliance/sports-lib';
import {
  ChartCursorBehaviours,
  XAxisTypes,
} from '@sports-alliance/sports-lib';
import { AppThemes } from '@sports-alliance/sports-lib';
import {
  DistanceUnits,
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  UserUnitSettingsInterface,
  VerticalSpeedUnits,
  WeightUnits,
} from '@sports-alliance/sports-lib';
import { ACTIVITIES_EXCLUDED_FROM_ASCENT, ACTIVITIES_EXCLUDED_FROM_DESCENT } from '@sports-alliance/sports-lib';
import { AppDashboardSettingsInterface } from '../../models/app-user.interface';
import { LapTypesHelper } from '@sports-alliance/sports-lib';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { ActivityTypesHelper } from '@sports-alliance/sports-lib';
import {
  MapTypes,
  UserMapSettingsInterface
} from '@sports-alliance/sports-lib';
import { AppThemePreference, isAppThemePreference, SYSTEM_THEME_PREFERENCE } from '../../models/app-theme-preference.type';
import {
  buildUnitSettingsForUnitSetupPreset,
  resolveUnitSetupPreset,
  UNIT_SETUP_PRESET_OPTIONS,
  UnitSetupPreset,
} from '../../helpers/unit-setup-preset.helper';
import {
  getAppAdvancedChartDataTypes,
  getAppBasicChartDataTypes,
  getAppCanonicalChartDataTypes,
} from '../../helpers/app-chart-data-types.helper';
import { AppLocaleService } from '../../services/app.locale.service';
import {
  APP_FORMAT_LOCALE_OPTIONS,
  buildAppFormatLocalePreview,
  normalizeAppFormatLocalePreference,
} from '../../shared/adapters/app-locale';

type SettingsSectionId = 'training' | 'privacy' | 'dashboard' | 'map' | 'charts' | 'units' | 'account';

interface SettingsSectionOption {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: string;
}

@Component({
  selector: 'app-user-settings',
  templateUrl: './user-settings.component.html',
  styleUrls: ['./user-settings.component.scss'],
  standalone: false
})
export class UserSettingsComponent implements OnChanges, OnDestroy, OnInit {

  public mandatoryAscentExclusions = ACTIVITIES_EXCLUDED_FROM_ASCENT;
  public mandatoryDescentExclusions = ACTIVITIES_EXCLUDED_FROM_DESCENT;

  @Input() user: AppUserInterface;
  public isSaving: boolean;
  private lastDistinctLinePatternsValue = false;
  public isDeleting: boolean;
  public consentToDelete: boolean;
  public errorDeleting;
  public errorSaving: string | null = null;
  public activeSection: SettingsSectionId | null = null;
  public readonly customUnitsExpanded = signal(false);
  public readonly sectionSummaries = signal<Partial<Record<SettingsSectionId, string>>>({});
  public readonly sectionOrder: SettingsSectionId[] = [
    'units',
    'dashboard',
    'training',
    'charts',
    'map',
    'privacy',
    'account',
  ];
  public readonly settingsSectionOptions: SettingsSectionOption[] = [
    {
      id: 'units',
      label: 'Units & formatting',
      description: 'Measurement units, regional format, and week start',
      icon: 'straighten',
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      description: 'Summary and table behavior',
      icon: 'dashboard_customize',
    },
    {
      id: 'training',
      label: 'Training load',
      description: 'Dated sport preferences for fitness and fatigue',
      icon: 'monitor_heart',
    },
    {
      id: 'charts',
      label: 'Charts',
      description: 'Metrics and chart defaults',
      icon: 'monitoring',
    },
    {
      id: 'map',
      label: 'Maps',
      description: 'Route rendering defaults',
      icon: 'map',
    },
    {
      id: 'privacy',
      label: 'Privacy & emails',
      description: 'Usage analytics and marketing emails',
      icon: 'privacy_tip',
    },
    {
      id: 'account',
      label: 'Account',
      description: 'Profile details, plan, and account deletion',
      icon: 'account_circle',
    },
  ];
  public readonly settingsGroups = [
    { id: 'preferences', label: 'Preferences', sections: this.settingsSectionOptions.slice(0, 5) },
    { id: 'privacy-account', label: 'Privacy & account', sections: this.settingsSectionOptions.slice(5) },
  ];
  public readonly brandTextMaxLength = 60;

  public xAxisTypes = XAxisTypes;



  public dataGroups = [
    {
      name: 'Basic Data',
      data: getAppBasicChartDataTypes()
    },
    {
      name: 'Advanced Data',
      data: getAppAdvancedChartDataTypes()
    },
  ];

  public readonly appThemeOptions: Array<{ label: string; value: AppThemePreference }> = [
    { label: 'System', value: SYSTEM_THEME_PREFERENCE },
    { label: 'Light', value: AppThemes.Normal },
    { label: 'Dark', value: AppThemes.Dark },
  ];
  public lapTypes = LapTypesHelper.getLapTypesAsUniqueArray();

  public eventsPerPage = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

  public mapTypes = MapTypes;

  public speedUnits = SpeedUnits;
  public readonly distanceUnitOptions: Array<{ label: string; value: DistanceUnits }> = [
    { label: 'Kilometers', value: DistanceUnits.Kilometers },
    { label: 'Miles', value: DistanceUnits.Miles },
  ];
  public readonly weightUnitOptions: Array<{ label: string; value: WeightUnits }> = [
    { label: 'Kilograms (kg)', value: WeightUnits.Kilograms },
    { label: 'Pounds (lb)', value: WeightUnits.Pounds },
  ];
  public readonly unitPresetOptions = UNIT_SETUP_PRESET_OPTIONS;
  public readonly formatLocaleOptions = APP_FORMAT_LOCALE_OPTIONS.map(option => ({
    ...option,
    preview: buildAppFormatLocalePreview(option.value),
  }));
  public selectedUnitPreset: UnitSetupPreset | null = null;
  public verticalSpeedUnits = VerticalSpeedUnits;
  public paceUnits = PaceUnits;
  public swimPaceUnits = SwimPaceUnits;
  public userSettingsFormGroup: UntypedFormGroup;

  public activityTypes = ActivityTypesHelper.getActivityTypesAsUniqueArray();
  private analyticsService = inject(AppAnalyticsService);
  private clipboard = inject(Clipboard);
  private hapticsService = inject(AppHapticsService);
  private localeService = inject(AppLocaleService);

  public get selectedFormatLocaleLabel(): string {
    const selected = normalizeAppFormatLocalePreference(
      this.userSettingsFormGroup?.get('formatLocale')?.value,
    );
    return this.formatLocaleOptions.find(option => option.value === selected)?.label
      ?? this.formatLocaleOptions[0].label;
  }



  public isAdminUser = false;
  private initializedUserUID: string | null = null;
  private routeSubscription?: Subscription;
  private formSubscription?: Subscription;
  private readonly controlLabels: Record<string, string> = {
    displayName: 'Name',
    appTheme: 'Interface Theme',
    formatLocale: 'Regional formatting',
    dataTypesToUse: 'Default chart metrics',
    xAxisType: 'Data Scaling (X-Axis)',
    chartStrokeWidth: 'Line Width',
    chartFillOpacity: 'Fill Intensity',
    startOfTheWeek: 'Start of the Week',
    distanceUnitsToUse: 'Distance Units',
    weightUnitsToUse: 'Weight Units',
    speedUnitsToUse: 'Preferred Speed Units',
    paceUnitsToUse: 'Preferred Pace Units',
    swimPaceUnitsToUse: 'Swim Pace Preference',
    verticalSpeedUnitsToUse: 'Vertical Speed Preference',
    mapType: 'Map Layer (Default)',
    eventsPerPage: 'Activities per Page',
  };

  get isProUser(): boolean {
    return AppUserUtilities.isProUser(this.user, this.isAdminUser);
  }

  get isBasicUser(): boolean {
    return AppUserUtilities.isBasicUser(this.user);
  }

  get canEditBrandText(): boolean {
    return AppUserUtilities.hasPaidAccessUser(this.user, this.isAdminUser);
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

  ngOnInit(): void {
    this.applyRouteSectionParam();
    this.routeSubscription = this.route.queryParamMap.subscribe(params => {
      this.applySectionParam(params.get('section'));
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.formSubscription?.unsubscribe();
  }



  ngOnChanges(): void {
    if (!this.user) {
      return;
    }

    if (this.user) {
      void this.userService.isAdmin()
        .then(isAdmin => {
          this.isAdminUser = isAdmin;
          this.syncBrandTextControlState();
          this.refreshSectionSummaries();
        })
        .catch((error) => {
          this.isAdminUser = false;
          this.syncBrandTextControlState();
          this.refreshSectionSummaries();
          this.logger.error('[UserSettingsComponent] Failed to resolve admin status', error);
        });
    }

    const shouldPreserveDirtyFormState = !!this.userSettingsFormGroup
      && this.initializedUserUID === this.user.uid
      && this.userSettingsFormGroup.dirty;
    if (shouldPreserveDirtyFormState) {
      // Consent may change in another tab or through an email unsubscribe link.
      // Refresh untouched switches without discarding an explicit local choice.
      for (const field of ['acceptedTrackingPolicy', 'acceptedMarketingPolicy'] as const) {
        const control = this.userSettingsFormGroup.get(field);
        if (control.pristine) control.setValue(this.user[field] === true, { emitEvent: false });
      }
      const linePatternsControl = this.userSettingsFormGroup.get('useDistinctComparisonLinePatterns');
      if (linePatternsControl.pristine) {
        const savedChartSettings = this.user.settings?.chartSettings as AppChartSettingsInterface | undefined;
        const savedValue = savedChartSettings?.useDistinctComparisonLinePatterns === true;
        linePatternsControl.setValue(savedValue, { emitEvent: false });
        this.lastDistinctLinePatternsValue = savedValue;
      }
      this.syncBrandTextControlState();
      this.refreshSectionSummaries();
      return;
    }

    const settings = AppUserUtilities.fillMissingAppSettings(this.user as unknown as User);
    const chartSettings = settings.chartSettings as unknown as AppChartSettingsInterface;
    this.lastDistinctLinePatternsValue = chartSettings.useDistinctComparisonLinePatterns === true;

    // Initialize the user settings and get the enabled ones
    const dataTypesToUse = Object.keys(settings.chartSettings.dataTypeSettings).filter((dataTypeSettingKey) =>
      settings.chartSettings.dataTypeSettings[dataTypeSettingKey].enabled === true
    );

    const initialThemePreference = isAppThemePreference(settings.appSettings.themePreference)
      ? settings.appSettings.themePreference
      : (isAppThemePreference(settings.appSettings.theme) ? settings.appSettings.theme : AppThemes.Normal);

    this.formSubscription?.unsubscribe();
    this.userSettingsFormGroup = new UntypedFormGroup({
      displayName: new UntypedFormControl(this.user.displayName, []),
      dataTypesToUse: new UntypedFormControl(dataTypesToUse, [
        Validators.required,
      ]),
      appTheme: new UntypedFormControl(
        initialThemePreference,
        [
          Validators.required,
        ]),
      formatLocale: new UntypedFormControl(
        normalizeAppFormatLocalePreference(settings.appSettings.formatLocale),
        [Validators.required],
      ),
      acceptedTrackingPolicy: new UntypedFormControl(this.user.acceptedTrackingPolicy === true, []),
      acceptedMarketingPolicy: new UntypedFormControl(this.user.acceptedMarketingPolicy === true, []),
      brandText: new UntypedFormControl(
        {
          value: (this.user as any).brandText || '',
          disabled: !this.canEditBrandText,
        },
        [this.maxTrimmedLength(this.brandTextMaxLength)]
      ),
      chartDownSamplingLevel: new UntypedFormControl(settings.chartSettings.downSamplingLevel, [
        Validators.required,
      ]),
      chartStrokeWidth: new UntypedFormControl(settings.chartSettings.strokeWidth, [
        Validators.required,
      ]),
      chartGainAndLossThreshold: new UntypedFormControl(settings.chartSettings.gainAndLossThreshold, [
        Validators.required,
      ]),
      chartStrokeOpacity: new UntypedFormControl(settings.chartSettings.strokeOpacity, [
        Validators.required,
      ]),
      chartFillOpacity: new UntypedFormControl(AppUserUtilities.getResolvedChartFillOpacity(chartSettings), [
        Validators.required,
      ]),
      chartLapTypes: new UntypedFormControl(settings.chartSettings.lapTypes, []),
      showChartLaps: new UntypedFormControl(settings.chartSettings.showLaps, []),
      showChartSwimLengths: new UntypedFormControl(chartSettings.showSwimLengths !== false, []),
      showChartGrid: new UntypedFormControl(settings.chartSettings.showGrid, []),
      xAxisType: new UntypedFormControl(settings.chartSettings.xAxisType, [
        Validators.required,
      ]),
      useAnimations: new UntypedFormControl(settings.chartSettings.useAnimations, []),
      useDistinctComparisonLinePatterns: new UntypedFormControl(this.lastDistinctLinePatternsValue, []),
      chartHideAllSeriesOnInit: new UntypedFormControl(settings.chartSettings.hideAllSeriesOnInit, []),
      showAllData: new UntypedFormControl(settings.chartSettings.showAllData, []),
      chartDisableGrouping: new UntypedFormControl(settings.chartSettings.disableGrouping, []),
      removeAscentForActivitiesSummaries: new UntypedFormControl([...new Set([...(settings.summariesSettings?.removeAscentForEventTypes || []), ...this.mandatoryAscentExclusions])], []),
      removeDescentForActivitiesSummaries: new UntypedFormControl([...new Set([...((settings.summariesSettings as any)?.removeDescentForEventTypes || []), ...this.mandatoryDescentExclusions])], []),
      chartCursorBehaviour: new UntypedFormControl(settings.chartSettings.chartCursorBehaviour === ChartCursorBehaviours.SelectX, []),
      startOfTheWeek: new UntypedFormControl(settings.unitSettings.startOfTheWeek, [
        Validators.required,
      ]),
      distanceUnitsToUse: new UntypedFormControl(settings.unitSettings.distanceUnits, [
        Validators.required,
      ]),
      weightUnitsToUse: new UntypedFormControl(settings.unitSettings.weightUnits, [
        Validators.required,
      ]),
      speedUnitsToUse: new UntypedFormControl(settings.unitSettings.speedUnits, [
        Validators.required,
      ]),
      paceUnitsToUse: new UntypedFormControl(settings.unitSettings.paceUnits, [
        Validators.required,
      ]),
      swimPaceUnitsToUse: new UntypedFormControl(settings.unitSettings.swimPaceUnits, [
        Validators.required,
      ]),
      verticalSpeedUnitsToUse: new UntypedFormControl(settings.unitSettings.verticalSpeedUnits, [
        Validators.required,
      ]),
      mapType: new UntypedFormControl(settings.mapSettings.mapType, []),
      mapStrokeWidth: new UntypedFormControl(settings.mapSettings.strokeWidth, []),
      showMapLaps: new UntypedFormControl(settings.mapSettings.showLaps, []),
      showMapArrows: new UntypedFormControl(settings.mapSettings.showArrows, []),
      mapLapTypes: new UntypedFormControl(settings.mapSettings.lapTypes, []),
      eventsPerPage: new UntypedFormControl(settings.dashboardSettings.tableSettings.eventsPerPage, [
        Validators.required,
      ]),
    });

    this.initializedUserUID = this.user.uid;
    this.syncBrandTextControlState();
    this.refreshSectionSummaries();
    this.formSubscription = this.userSettingsFormGroup.valueChanges.subscribe(() => {
      if (!this.isSaving) this.errorSaving = null;
      this.refreshSectionSummaries();
    });
  }

  hasError(field?: string) {
    if (!field) {
      return !this.userSettingsFormGroup.valid;
    }
    return !(this.userSettingsFormGroup.get(field).valid && this.userSettingsFormGroup.get(field).touched);
  }

  get invalidControlDiagnostics(): Array<{ control: string; label: string; errors: string[] }> {
    if (!this.userSettingsFormGroup) {
      return [];
    }

    return Object.entries(this.userSettingsFormGroup.controls)
      .filter(([, control]) => control.invalid)
      .map(([controlName, control]) => ({
        control: controlName,
        label: this.controlLabels[controlName] || controlName,
        errors: Object.keys(control.errors || {}),
      }));
  }

  get shouldShowValidationDebug(): boolean {
    return !!this.userSettingsFormGroup && this.userSettingsFormGroup.invalid;
  }

  isMandatoryExclusion(type: any): boolean {
    return this.mandatoryAscentExclusions.indexOf(type) >= 0;
  }

  isMandatoryDescentExclusion(type: any): boolean {
    return this.mandatoryDescentExclusions.indexOf(type) >= 0;
  }

  async toggleSettingsSection(section: SettingsSectionId): Promise<void> {
    await this.selectSettingsSection(section === this.activeSection ? null : section);
  }

  async selectSettingsSection(section: SettingsSectionId | null): Promise<void> {
    if (section === this.activeSection || this.isSaving || this.isDeleting) return;
    this.activeSection = section;
    this.hapticsService.selection();

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section },
      queryParamsHandling: 'merge',
    });
  }

  copyUserId(): void {
    const userId = `${this.user?.uid || ''}`.trim();
    if (!userId) {
      return;
    }

    if (this.clipboard.copy(userId)) {
      this.snackBar.open('User ID copied.', undefined, { duration: 2000 });
      this.hapticsService.success();
      return;
    }

    this.snackBar.open('Could not copy the user ID. Please copy it manually.', undefined, { duration: 4000 });
    this.hapticsService.error();
  }

  onUnitPresetChange(preset: UnitSetupPreset): void {
    if (this.isSaving || this.isDeleting || preset === this.selectedUnitPreset) return;
    this.selectedUnitPreset = preset;
    const presetSettings = buildUnitSettingsForUnitSetupPreset(preset);

    this.userSettingsFormGroup.patchValue({
      distanceUnitsToUse: presetSettings.distanceUnits,
      speedUnitsToUse: presetSettings.speedUnits,
      paceUnitsToUse: presetSettings.paceUnits,
      swimPaceUnitsToUse: presetSettings.swimPaceUnits,
      verticalSpeedUnitsToUse: presetSettings.verticalSpeedUnits,
    });
    this.userSettingsFormGroup.markAsDirty();
    this.hapticsService.selection();
  }

  toggleCustomUnits(): void {
    if (this.isSaving || this.isDeleting) return;
    this.customUnitsExpanded.update(expanded => !expanded);
    this.hapticsService.selection();
  }

  onPreferenceChange(): void {
    if (this.isSaving || this.isDeleting) return;
    this.hapticsService.selection();
  }

  onDistinctLinePatternsChange(enabled: boolean): void {
    if (this.isSaving || enabled === this.lastDistinctLinePatternsValue) {
      return;
    }
    this.lastDistinctLinePatternsValue = enabled;
    this.hapticsService.selection();
  }

  onPrivacyPreferenceChange(): void {
    if (this.isSaving || this.isDeleting) return;
    this.hapticsService.selection();
  }

  onFormatLocaleChange(): void {
    this.hapticsService.selection();
  }

  onWeightUnitChange(): void {
    this.hapticsService.selection();
  }

  async onSubmit(event) {
    event.preventDefault();
    if (this.isSaving || this.isDeleting || !this.userSettingsFormGroup.dirty) return;
    if (!this.userSettingsFormGroup.valid) {
      const invalidControls = this.invalidControlDiagnostics;
      this.logger.warn('[UserSettingsComponent] Save blocked by invalid form controls', {
        uid: this.user?.uid,
        invalidControls,
      });
      this.validateAllFormFields(this.userSettingsFormGroup);
      return;
    }

    this.isSaving = true;
    this.errorSaving = null;
    const linePatternsControl = this.userSettingsFormGroup.get('useDistinctComparisonLinePatterns');
    const lockedControls = [linePatternsControl,
      this.userSettingsFormGroup.get('acceptedTrackingPolicy'),
      this.userSettingsFormGroup.get('acceptedMarketingPolicy')];
    lockedControls.forEach(control => control.disable({ emitEvent: false }));
    try {
      const dataTypesToUseValue = this.userSettingsFormGroup.get('dataTypesToUse').value as string[];

      // Get all available data types from both groups
      const allDataTypes = getAppCanonicalChartDataTypes();
      // Create a Set for O(1) lookup of selected types
      const selectedTypesSet = new Set(dataTypesToUseValue);

      // Build dataTypeSettings with enabled: true for selected, enabled: false for unselected
      const dataTypeSettings: { [key: string]: { enabled: boolean } } = {};
      for (const dataType of allDataTypes) {
        dataTypeSettings[dataType] = { enabled: selectedTypesSet.has(dataType) };
      }

      const currentChartSettings = (this.user?.settings?.chartSettings || {}) as unknown as AppChartSettingsInterface;
      const userChartSettings: AppChartSettingsInterface = {
        dataTypeSettings: dataTypeSettings,
        useAnimations: this.userSettingsFormGroup.get('useAnimations').value,
        ...(linePatternsControl.dirty
          ? { useDistinctComparisonLinePatterns: linePatternsControl.value === true }
          : {}),
        xAxisType: this.userSettingsFormGroup.get('xAxisType').value,
        showAllData: this.userSettingsFormGroup.get('showAllData').value,
        colorAltitudeByGrade: currentChartSettings.colorAltitudeByGrade !== false,
        chartCursorBehaviour: this.userSettingsFormGroup.get('chartCursorBehaviour').value ? ChartCursorBehaviours.SelectX : ChartCursorBehaviours.ZoomX,
        strokeWidth: this.userSettingsFormGroup.get('chartStrokeWidth').value,
        strokeOpacity: this.userSettingsFormGroup.get('chartStrokeOpacity').value,
        fillOpacity: this.userSettingsFormGroup.get('chartFillOpacity').value,
        fillOpacityVersion: 1,
        lapTypes: this.userSettingsFormGroup.get('chartLapTypes').value,
        showLaps: this.userSettingsFormGroup.get('showChartLaps').value,
        showSwimLengths: this.userSettingsFormGroup.get('showChartSwimLengths').value,
        showGrid: this.userSettingsFormGroup.get('showChartGrid').value,
        stackYAxes: false,
        disableGrouping: this.userSettingsFormGroup.get('chartDisableGrouping').value,
        hideAllSeriesOnInit: this.userSettingsFormGroup.get('chartHideAllSeriesOnInit').value,
        gainAndLossThreshold: this.userSettingsFormGroup.get('chartGainAndLossThreshold').value,
        downSamplingLevel: this.userSettingsFormGroup.get('chartDownSamplingLevel').value,
      };

      const selectedThemeControlValue = this.userSettingsFormGroup.get('appTheme').value;
      const selectedThemePreference = isAppThemePreference(selectedThemeControlValue)
        ? selectedThemeControlValue
        : AppThemes.Normal;
      const resolvedTheme = selectedThemePreference === SYSTEM_THEME_PREFERENCE
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? AppThemes.Dark : AppThemes.Normal)
        : selectedThemePreference;
      const settings = AppUserUtilities.fillMissingAppSettings(this.user as unknown as User);
      const savedFormatLocale = normalizeAppFormatLocalePreference(settings.appSettings.formatLocale);
      const selectedFormatLocale = normalizeAppFormatLocalePreference(
        this.userSettingsFormGroup.get('formatLocale').value,
      );
      const formatLocaleChanged = selectedFormatLocale !== savedFormatLocale;
      const shouldCompleteUnitSetup = this.shouldCompleteUnitSetupFromForm(settings);
      const appSettingsToSave: AppAppSettingsInterface = {
        theme: resolvedTheme,
        themePreference: selectedThemePreference,
        formatLocale: selectedFormatLocale,
      };
      if (shouldCompleteUnitSetup) {
        appSettingsToSave.unitSetupCompleted = true;
      }

      const propertiesToUpdate: any = {
        displayName: this.userSettingsFormGroup.get('displayName').value,
        settings: <UserSettingsInterface>{
          chartSettings: userChartSettings as unknown as UserSettingsInterface['chartSettings'],
          appSettings: appSettingsToSave,
          mapSettings: <UserMapSettingsInterface>{
            showLaps: this.userSettingsFormGroup.get('showMapLaps').value,

            showArrows: this.userSettingsFormGroup.get('showMapArrows').value,
            lapTypes: this.userSettingsFormGroup.get('mapLapTypes').value,
            mapType: this.userSettingsFormGroup.get('mapType').value,
            strokeWidth: this.userSettingsFormGroup.get('mapStrokeWidth').value
          },
          unitSettings: <UserUnitSettingsInterface>{
            speedUnits: this.userSettingsFormGroup.get('speedUnitsToUse').value,
            gradeAdjustedSpeedUnits: AppUserUtilities.getGradeAdjustedSpeedUnitsFromSpeedUnits(this.userSettingsFormGroup.get('speedUnitsToUse').value),
            paceUnits: this.userSettingsFormGroup.get('paceUnitsToUse').value,
            gradeAdjustedPaceUnits: AppUserUtilities.getGradeAdjustedPaceUnitsFromPaceUnits(this.userSettingsFormGroup.get('paceUnitsToUse').value),
            swimPaceUnits: this.userSettingsFormGroup.get('swimPaceUnitsToUse').value,
            verticalSpeedUnits: this.userSettingsFormGroup.get('verticalSpeedUnitsToUse').value,
            distanceUnits: this.userSettingsFormGroup.get('distanceUnitsToUse').value,
            weightUnits: this.userSettingsFormGroup.get('weightUnitsToUse').value,
            startOfTheWeek: this.userSettingsFormGroup.get('startOfTheWeek').value,
          },
          dashboardSettings: <AppDashboardSettingsInterface>{
            tableSettings: {
              eventsPerPage: this.userSettingsFormGroup.get('eventsPerPage').value
            }
          },
          summariesSettings: {
            removeAscentForEventTypes: this.userSettingsFormGroup.get('removeAscentForActivitiesSummaries').value,
            removeDescentForEventTypes: this.userSettingsFormGroup.get('removeDescentForActivitiesSummaries').value
          },
          exportToCSVSettings: settings.exportToCSVSettings
        }
      };

      const acceptedTrackingPolicyControl = this.userSettingsFormGroup.get('acceptedTrackingPolicy');
      const acceptedMarketingPolicyControl = this.userSettingsFormGroup.get('acceptedMarketingPolicy');
      if (acceptedTrackingPolicyControl?.dirty) {
        propertiesToUpdate.acceptedTrackingPolicy = acceptedTrackingPolicyControl.value === true;
      }
      if (acceptedMarketingPolicyControl?.dirty) {
        propertiesToUpdate.acceptedMarketingPolicy = acceptedMarketingPolicyControl.value === true;
      }

      if (this.canEditBrandText) {
        const rawBrandText = this.userSettingsFormGroup.get('brandText')?.value ?? '';
        const trimmedBrandText = typeof rawBrandText === 'string' ? rawBrandText.trim() : '';
        propertiesToUpdate.brandText = trimmedBrandText.length > 0 ? trimmedBrandText : null;
      }

      await this.userService.updateUserProperties(this.user, propertiesToUpdate);
      const localeSyncResult = formatLocaleChanged
        ? this.localeService.cachePreference(selectedFormatLocale)
        : 'unchanged';
      this.userSettingsFormGroup.markAsPristine();
      this.userSettingsFormGroup.markAsUntouched();
      this.analyticsService.logEvent('user_settings_update');

      if (localeSyncResult === 'storage-unavailable') {
        this.snackBar.open('Settings saved, but this browser could not apply the regional format.', undefined, {
          duration: 5000,
        });
        this.hapticsService.warning();
        return;
      }

      this.snackBar.open(
        localeSyncResult === 'updated' ? 'Settings saved. Applying regional format…' : 'Settings saved.',
        undefined,
        { duration: 2000 },
      );
      this.hapticsService.success();
      if (localeSyncResult === 'updated') this.localeService.reload();
    } catch (e) {
      this.errorSaving = 'Changes could not be saved. Try again.';
      this.logger.error('[UserSettingsComponent] onSubmit FAILED. Error details:', e);
      this.snackBar.open('Could not update user', undefined, {
        duration: 2000,
      });
      this.hapticsService.error();
    } finally {
      this.isSaving = false;
      lockedControls.forEach(control => control.enable({ emitEvent: false }));
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

  private syncBrandTextControlState(): void {
    const brandTextControl = this.userSettingsFormGroup?.get('brandText');
    if (!brandTextControl) return;

    if (this.canEditBrandText) {
      if (brandTextControl.disabled) {
        brandTextControl.enable({ emitEvent: false });
      }
      return;
    }

    if (brandTextControl.enabled) {
      brandTextControl.disable({ emitEvent: false });
    }
  }

  private applyRouteSectionParam(): void {
    const section = this.route.snapshot.queryParamMap?.get('section')
      || this.route.snapshot.queryParams?.['section'];
    this.applySectionParam(section);
  }

  private applySectionParam(section: unknown): void {
    if (section === 'delete-account' || section === 'profile') {
      this.activeSection = 'account';
      return;
    }

    if (this.isSettingsSection(section)) {
      this.activeSection = section;
      return;
    }

    this.activeSection = null;
  }

  private isSettingsSection(section: unknown): section is SettingsSectionId {
    return typeof section === 'string' && this.sectionOrder.includes(section as SettingsSectionId);
  }

  private refreshSectionSummaries(): void {
    if (!this.userSettingsFormGroup) return;
    const value = this.userSettingsFormGroup.getRawValue();
    const distance = this.distanceUnitOptions.find(option => option.value === value.distanceUnitsToUse)?.label;
    const weight = this.weightUnitOptions.find(option => option.value === value.weightUnitsToUse)?.label;
    const metrics = Array.isArray(value.dataTypesToUse) ? value.dataTypesToUse.length : 0;
    const map = Object.entries(this.mapTypes).find(([, type]) => type === value.mapType)?.[0]?.replace(/([a-z])([A-Z])/g, '$1 $2');
    const plan = this.isProUser ? 'Pro plan' : this.isBasicUser ? 'Basic plan' : 'Free plan';
    this.selectedUnitPreset = resolveUnitSetupPreset({
      distanceUnits: value.distanceUnitsToUse,
      speedUnits: value.speedUnitsToUse,
      paceUnits: value.paceUnitsToUse,
      swimPaceUnits: value.swimPaceUnitsToUse,
      verticalSpeedUnits: value.verticalSpeedUnitsToUse,
    });
    this.sectionSummaries.set({
      units: [distance, weight, this.selectedFormatLocaleLabel].filter(Boolean).join(' · '),
      dashboard: `${value.eventsPerPage} activities per page`,
      charts: `${metrics} default ${metrics === 1 ? 'metric' : 'metrics'} · ${value.xAxisType} axis`,
      map: [map, value.showMapArrows ? 'Direction arrows on' : 'Direction arrows off'].filter(Boolean).join(' · '),
      privacy: `Analytics ${value.acceptedTrackingPolicy === true ? 'on' : 'off'} · Marketing ${value.acceptedMarketingPolicy === true ? 'on' : 'off'}`,
      account: [value.displayName?.trim() || this.user.email, plan].filter(Boolean).join(' · '),
    });
  }

  private shouldCompleteUnitSetupFromForm(settings: AppUserSettingsInterface): boolean {
    if ((settings.appSettings as any)?.unitSetupCompleted !== false || !this.userSettingsFormGroup) {
      return false;
    }

    const unitSettings = settings.unitSettings;
    return this.userSettingsFormGroup.get('startOfTheWeek')?.value !== unitSettings.startOfTheWeek
      || this.userSettingsFormGroup.get('distanceUnitsToUse')?.value !== unitSettings.distanceUnits
      || this.userSettingsFormGroup.get('weightUnitsToUse')?.value !== unitSettings.weightUnits
      || !this.areFormArraysEqual(this.userSettingsFormGroup.get('speedUnitsToUse')?.value, unitSettings.speedUnits)
      || !this.areFormArraysEqual(this.userSettingsFormGroup.get('paceUnitsToUse')?.value, unitSettings.paceUnits)
      || !this.areFormArraysEqual(this.userSettingsFormGroup.get('swimPaceUnitsToUse')?.value, unitSettings.swimPaceUnits)
      || !this.areFormArraysEqual(this.userSettingsFormGroup.get('verticalSpeedUnitsToUse')?.value, unitSettings.verticalSpeedUnits);
  }

  private areFormArraysEqual(left: unknown, right: unknown): boolean {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }

    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => value === right[index]);
  }

  private maxTrimmedLength(maxLength: number): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (typeof control.value !== 'string') {
        return null;
      }
      const trimmedLength = control.value.trim().length;
      if (trimmedLength <= maxLength) {
        return null;
      }
      return {
        maxTrimmedLength: {
          requiredLength: maxLength,
          actualLength: trimmedLength,
        },
      };
    };
  }

  public deleteUser(event: Event) {
    event.preventDefault();
    if (this.isSaving || this.isDeleting) {
      return;
    }

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
        this.hapticsService.success();
        localStorage.clear();
        this.windowService.windowRef.location.reload();
      } catch (e) {
        this.logger.error(e);
        this.errorDeleting = e;
        this.hapticsService.error();
        this.isDeleting = false;
      }
    });
  }
}
