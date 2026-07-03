import { AfterViewInit, Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  ActivityTypes,
  DataAerobicTrainingEffect,
  DataAltitudeAvg,
  DataAltitudeMax,
  DataAltitudeMin,
  DataAscent,
  DataCadenceAvg,
  DataCadenceMax,
  DataCadenceMin,
  DataDescent,
  DataDistance,
  DataDuration,
  DataEnergy,
  DataFeeling,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataHeartRateMin,
  DataPeakEPOC,
  DataPowerAvg,
  DataPowerMax,
  DataPowerMin,
  DataRPE,
  DataTemperatureAvg,
  DataTemperatureMax,
  DataTemperatureMin,
  DataVO2Max,
  SpeedUnitsToGradeAdjustedSpeedUnits,
  TileChartSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import * as SpeedAvg from '@sports-alliance/sports-lib';
import * as SpeedMin from '@sports-alliance/sports-lib';
import * as SpeedMax from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import { AppUserInterface } from '../../../models/app-user.interface';
import type {
  AppDashboardAutoTileState,
  AppDashboardChartTileDisplaySettingsInterface,
  AppDashboardChartTileSettingsInterface,
  AppDashboardMapTileSettingsInterface,
  AppDashboardSettingsInterface,
  AppDashboardTileEventFilterRange,
  AppDashboardTileEventFiltersInterface,
} from '../../../models/app-user.interface';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE,
  DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE,
  DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_POWER_CURVE_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  DASHBOARD_SLEEP_TREND_CHART_TYPE,
  DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE,
  type DashboardCuratedChartType,
  type DashboardKpiGroup,
  getDashboardCuratedChartDefinitions,
  type DashboardKpiChartType,
  getDashboardKpiChartDefinitions,
  isDashboardKpiChartType,
  isDashboardCuratedChartType,
  isDashboardEventBackedSpecialChartType,
  isDashboardRecoveryNowChartType,
  isDashboardSpecialChartType,
  resolveDashboardChartCategory,
} from '../../../helpers/dashboard-special-chart-types';
import { AppUserUtilities } from '../../../utils/app.user.utilities';
import type { MapStyleName } from '../../../services/map/map-style.types';
import {
  buildDashboardManagerPresetTile,
  DASHBOARD_MANAGER_PRESET_IDS,
  getDashboardManagerPresetDefinition,
  getDashboardManagerPresetDefinitions,
  type DashboardManagerPresetCategory,
  type DashboardManagerPresetDefinition,
  type DashboardManagerPresetId,
} from '../../../helpers/dashboard-manager-presets.helper';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { AppSleepService } from '../../../services/app.sleep.service';
import {
  cloneDashboardTileEventFilters,
  DASHBOARD_TILE_EVENT_RANGE_OPTIONS,
  DASHBOARD_TILE_EVENT_DEFAULT_RANGE,
  normalizeDashboardTileEventFilters,
} from '../../../helpers/dashboard-tile-event-filters.helper';
import {
  cloneDashboardChartTileDisplaySettingsForChartType,
  normalizeDashboardChartTileDisplaySettingsForChartType,
} from '../../../helpers/dashboard-chart-display-settings.helper';
import { ConfirmationDialogComponent } from '../../confirmation-dialog/confirmation-dialog.component';
import { firstValueFrom, Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import {
  DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE,
  DASHBOARD_AUTO_TILE_CURATED_SOURCE,
  DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE,
  DASHBOARD_AUTO_TILE_KPI_SOURCE,
  DASHBOARD_AUTO_TILE_POWER_CURVE_ID,
  DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE,
  DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
  DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
  DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID,
  buildDashboardCuratedAutoTile,
  buildDashboardKpiAutoTile,
  buildDashboardSleepTrendAutoTile,
  getDashboardAutoTileDescriptorForTile,
  isDashboardSleepTrendTile,
  markDashboardAutoTileAdded,
  markDashboardAutoTileDismissed,
  type DashboardAutoTileDescriptor,
  type DashboardDefaultCuratedChartType,
} from '../../../helpers/dashboard-auto-tile.helper';

export interface DashboardManagerDialogData {
  user: AppUserInterface;
  initialMode?: 'add' | 'edit';
  initialEditTileOrder?: number | null;
}

export interface DashboardManagerDialogResult {
  saved: boolean;
}

type DashboardManagerCategory = DashboardManagerPresetCategory;
type DashboardMapTileSettings = AppDashboardMapTileSettingsInterface;
type DashboardManagerWorkflowTab = 'manual' | 'presets';

interface DataGroupInterface {
  name: string;
  data: string[];
  disabled?: boolean;
}

interface IconOption<TValue> {
  value: TValue;
  label: string;
  icon: string;
  description?: string;
}

interface DashboardManagerSettingsSnapshot {
  tiles: TileSettingsInterface[];
  dismissedCuratedRecoveryNowTile?: boolean;
  autoTiles: Partial<Record<string, AppDashboardAutoTileState>>;
}

type DashboardManagerSavingAction = 'save' | 'addDefaults' | 'addAll' | 'removeAll' | null;

@Component({
  selector: 'app-dashboard-manager-dialog',
  templateUrl: './dashboard-manager-dialog.component.html',
  styleUrls: ['./dashboard-manager-dialog.component.css'],
  standalone: false,
})
export class DashboardManagerDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly excludedChartTypePatterns = [
    /^bri.*dev/i,
    /^spiral$/i,
  ];

  public readonly chartTypes = ChartTypes;
  public readonly chartCategoryTypes = ChartDataCategoryTypes;
  public readonly chartValueTypes = ChartDataValueTypes;
  public readonly customChartTypeOptions = Object.values(ChartTypes).filter(chartType =>
    !DashboardManagerDialogComponent.excludedChartTypePatterns.some(pattern => pattern.test(`${chartType}`))
  );
  public readonly curatedChartDefinitions = getDashboardCuratedChartDefinitions();
  public readonly kpiChartDefinitions = getDashboardKpiChartDefinitions();
  public readonly kpiGroupOptions: IconOption<DashboardKpiGroup>[] = [
    {
      value: 'load',
      label: 'Load',
      icon: 'monitoring',
      description: 'Workload progression KPIs',
    },
    {
      value: 'readiness',
      label: 'Readiness',
      icon: 'self_improvement',
      description: 'Current and projected form KPIs',
    },
    {
      value: 'execution',
      label: 'Execution',
      icon: 'show_chart',
      description: 'How hard and how efficiently you execute',
    },
  ];
  public readonly workflowTabOptions: IconOption<DashboardManagerWorkflowTab>[] = [
    {
      value: 'manual',
      label: 'Manual',
      icon: 'tune',
      description: 'Configure tile settings field by field',
    },
    {
      value: 'presets',
      label: 'Presets',
      icon: 'auto_awesome',
      description: 'Quick-start from predefined dashboard tile templates',
    },
  ];
  public readonly modeOptions: IconOption<'add' | 'edit'>[] = [
    {
      value: 'add',
      label: 'Add tile',
      icon: 'add_circle',
      description: 'Create a new dashboard tile',
    },
    {
      value: 'edit',
      label: 'Edit tile',
      icon: 'edit',
      description: 'Update an existing dashboard tile',
    },
  ];
  public readonly categoryOptions: IconOption<DashboardManagerCategory>[] = [
    {
      value: 'curated',
      label: 'Curated',
      icon: 'auto_awesome',
      description: 'Fixed behavior, independent from dashboard date range',
    },
    {
      value: 'kpi',
      label: 'KPI',
      icon: 'monitoring',
      description: 'Compact derived KPI rows',
    },
    {
      value: 'custom',
      label: 'Custom',
      icon: 'tune',
      description: 'Configurable chart with its own event filters',
    },
    {
      value: 'map',
      label: 'Map',
      icon: 'map',
      description: 'Map tile with its own event filters',
    },
  ];
  public readonly presetCategoryOptions: IconOption<DashboardManagerPresetCategory>[] = [
    {
      value: 'curated',
      label: 'Curated',
      icon: 'auto_awesome',
      description: 'Recovery and Form fixed tiles',
    },
    {
      value: 'kpi',
      label: 'KPI',
      icon: 'monitoring',
      description: 'Derived KPI card templates',
    },
    {
      value: 'custom',
      label: 'Custom',
      icon: 'tune',
      description: 'Configurable chart templates',
    },
    {
      value: 'map',
      label: 'Map',
      icon: 'map',
      description: 'Map tile templates',
    },
  ];
  public readonly presetDefinitions = getDashboardManagerPresetDefinitions();
  public readonly curatedChartIconByType: Record<DashboardCuratedChartType, string> = {
    [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'health_and_safety',
    [DASHBOARD_FORM_CHART_TYPE]: 'insights',
    [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: 'trending_up',
    [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'bar_chart',
    [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'show_chart',
    [DASHBOARD_SLEEP_TREND_CHART_TYPE]: 'hotel',
    [DASHBOARD_POWER_CURVE_CHART_TYPE]: 'speed',
  };
  public readonly curatedChartDescriptionByType: Record<DashboardCuratedChartType, string> = {
    [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'Recovery left vs elapsed recovery.',
    [DASHBOARD_FORM_CHART_TYPE]: 'Fitness/fatigue/form trend from derived training stress.',
    [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: '7-day projected freshness from current CTL/ATL decay.',
    [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'Weekly easy/moderate/hard intensity split (Power or HR fallback).',
    [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'Weekly duration-weighted power/heart-rate efficiency trend.',
    [DASHBOARD_SLEEP_TREND_CHART_TYPE]: 'Sleep duration and stages by connected source.',
    [DASHBOARD_POWER_CURVE_CHART_TYPE]: 'Best power envelope with latest power ride comparison.',
  };
  public readonly kpiChartIconByType: Record<DashboardKpiChartType, string> = {
    [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'monitoring',
    [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'speed',
    [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'stacked_line_chart',
    [DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE]: 'speed',
    [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'self_improvement',
    [DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: 'fitness_center',
    [DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: 'battery_alert',
    [DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE]: 'trending_up',
    [DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE]: 'moving',
    [DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]: 'hourglass_empty',
    [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'trending_up',
    [DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE]: 'balance',
    [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'wb_sunny',
    [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'flash_on',
    [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'query_stats',
  };
  public readonly kpiChartDescriptionByType: Record<DashboardKpiChartType, string> = {
    [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'Acute/chronic workload ratio with 8-week sparkline.',
    [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: '7-day CTL change with 8-week sparkline.',
    [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'Weekly strain KPI with monotony context and sparkline.',
    [DASHBOARD_LOAD_STATUS_KPI_CHART_TYPE]: 'Current training state from Form, ramp, fitness, and fatigue.',
    [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'Current TSB readiness from derived load state.',
    [DASHBOARD_FITNESS_CTL_KPI_CHART_TYPE]: 'Current CTL from the derived Form model with 8-week sparkline.',
    [DASHBOARD_FATIGUE_ATL_KPI_CHART_TYPE]: 'Current ATL from the derived Form model with 8-week sparkline.',
    [DASHBOARD_FITNESS_TREND_KPI_CHART_TYPE]: 'Recent CTL direction from the derived Form model.',
    [DASHBOARD_FATIGUE_TREND_KPI_CHART_TYPE]: 'Recent ATL direction from the derived Form model.',
    [DASHBOARD_RECOVERY_DEBT_KPI_CHART_TYPE]: 'Estimated zero-load days until neutral current TSB.',
    [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'Current TSB projection at +7d with zero load.',
    [DASHBOARD_TRAINING_BALANCE_KPI_CHART_TYPE]: 'Latest weekly Easy/Moderate/Hard intensity balance.',
    [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'Latest weekly Easy (Z1-2) intensity share.',
    [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'Latest weekly Hard (Z5-7) intensity share.',
    [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'Current efficiency vs prior 4-week baseline.',
  };
  public readonly mapStyleOptions: Array<{ value: MapStyleName; label: string }> = [
    { value: 'default', label: 'Default' },
    { value: 'satellite', label: 'Satellite' },
    { value: 'outdoors', label: 'Outdoors' },
  ];
  public readonly timeIntervalOptions: Array<{ label: string; value: TimeIntervals }> = [
    { label: 'Auto', value: TimeIntervals.Auto },
    { label: 'Daily', value: TimeIntervals.Daily },
    { label: 'Weekly', value: TimeIntervals.Weekly },
    { label: 'Monthly', value: TimeIntervals.Monthly },
  ];
  public readonly tileEventRangeOptions = DASHBOARD_TILE_EVENT_RANGE_OPTIONS;

  public dataGroups: DataGroupInterface[] = [];

  public mode: 'add' | 'edit' = 'add';
  public activeWorkflowTab: DashboardManagerWorkflowTab = 'manual';
  public category: DashboardManagerCategory = 'custom';
  public editTileOrder: number | null = null;
  public curatedChartType: DashboardCuratedChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE;
  public kpiChartType: DashboardKpiChartType = DASHBOARD_ACWR_KPI_CHART_TYPE;
  public kpiGroup: DashboardKpiGroup = 'load';
  public presetKpiGroup: DashboardKpiGroup = 'load';

  public customChartType: ChartTypes = AppUserUtilities.getDefaultUserDashboardChartTile().chartType;
  public customDataType = AppUserUtilities.getDefaultUserDashboardChartTile().dataType;
  public customDataValueType = AppUserUtilities.getDefaultUserDashboardChartTile().dataValueType;
  public customDataCategoryType = AppUserUtilities.getDefaultUserDashboardChartTile().dataCategoryType;
  public customTimeInterval = AppUserUtilities.getDefaultUserDashboardChartTile().dataTimeInterval;
  public customEventRange: AppDashboardTileEventFilterRange = AppUserUtilities.getDefaultDashboardTileEventFilters().range || DASHBOARD_TILE_EVENT_DEFAULT_RANGE;
  public customEventActivityTypes = AppUserUtilities.getDefaultDashboardTileEventFilters().activityTypes;

  public mapStyle: MapStyleName = this.normalizeMapStyle(AppUserUtilities.getDefaultDashboardMapStyle());
  public mapClusterMarkers = true;
  public mapEventRange: AppDashboardTileEventFilterRange = AppUserUtilities.getDefaultDashboardTileEventFilters().range || DASHBOARD_TILE_EVENT_DEFAULT_RANGE;
  public mapEventActivityTypes = AppUserUtilities.getDefaultDashboardTileEventFilters().activityTypes;
  public presetCategory: DashboardManagerPresetCategory = 'curated';
  public selectedPresetId: DashboardManagerPresetId | null = DASHBOARD_MANAGER_PRESET_IDS.CURATED_RECOVERY;

  public isSaving = false;
  public savingAction: DashboardManagerSavingAction = null;
  public saveError = '';

  private hasSavedChanges = false;
  private hasSleepDataForAddAll = false;
  private sleepEligibilitySubscription = new Subscription();
  private shouldAutoFocusEditSection = false;

  @ViewChild('customSection') private customSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('curatedSection') private curatedSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('kpiSection') private kpiSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('mapSection') private mapSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('customChartTypeSelect') private customChartTypeSelect?: MatSelect;
  @ViewChild('mapStyleSelect') private mapStyleSelect?: MatSelect;
  @ViewChild('editTileSelect') private editTileSelect?: MatSelect;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DashboardManagerDialogData,
    private dialogRef: MatDialogRef<DashboardManagerDialogComponent, DashboardManagerDialogResult>,
    private dialog: MatDialog,
    private userService: AppUserService,
    private hapticsService: AppHapticsService,
    private sleepService: AppSleepService,
  ) { }

  ngOnInit(): void {
    if (!this.data?.user) {
      throw new Error('Dashboard manager dialog requires a user.');
    }

    if (!this.data.user.settings) {
      this.data.user.settings = {} as any;
    }
    if (!this.data.user.settings.dashboardSettings) {
      this.data.user.settings.dashboardSettings = {
        tiles: [],
      } as any;
    }
    if (!Array.isArray(this.data.user.settings.dashboardSettings.tiles)) {
      this.data.user.settings.dashboardSettings.tiles = [];
    }

    this.dataGroups = this.buildDataGroups();
    this.ensurePresetSelection();
    this.watchSleepEligibilityForAddAll();

    if (this.dashboardTiles.length > 0) {
      this.editTileOrder = this.dashboardTiles[0].order;
    }

    const requestedInitialMode = this.data?.initialMode;
    if (requestedInitialMode === 'edit' && this.dashboardTiles.length > 0) {
      const requestedEditOrder = Number(this.data?.initialEditTileOrder);
      const hasRequestedOrder = Number.isFinite(requestedEditOrder)
        && this.dashboardTiles.some(tile => tile.order === requestedEditOrder);
      this.mode = 'edit';
      this.editTileOrder = hasRequestedOrder ? requestedEditOrder : this.dashboardTiles[0].order;
      const editTarget = this.resolveEditTile();
      if (editTarget) {
        this.syncFormStateFromTile(editTarget);
        this.shouldAutoFocusEditSection = true;
      }
    }
  }

  ngAfterViewInit(): void {
    this.scrollAndFocusInitialEditSection();
  }

  ngOnDestroy(): void {
    this.sleepEligibilitySubscription.unsubscribe();
  }

  get dashboardTiles(): TileSettingsInterface[] {
    return [...(this.data?.user?.settings?.dashboardSettings?.tiles || [])]
      .sort((left, right) => left.order - right.order);
  }

  get chartTiles(): TileChartSettingsInterface[] {
    return this.dashboardTiles
      .filter(tile => tile.type === TileTypes.Chart)
      .map(tile => tile as TileChartSettingsInterface);
  }

  get workflowTabIndex(): number {
    return this.activeWorkflowTab === 'presets' ? 1 : 0;
  }

  get filteredPresetDefinitions(): DashboardManagerPresetDefinition[] {
    return this.presetDefinitions.filter((definition) => {
      if (definition.category !== this.presetCategory) {
        return false;
      }
      if (definition.category !== 'kpi') {
        return true;
      }
      return definition.kpiGroup === this.presetKpiGroup;
    });
  }

  get filteredKpiChartDefinitions() {
    return this.kpiChartDefinitions.filter(definition => definition.group === this.kpiGroup);
  }

  get selectedPresetDefinition(): DashboardManagerPresetDefinition | null {
    if (!this.selectedPresetId) {
      return null;
    }
    return getDashboardManagerPresetDefinition(this.selectedPresetId);
  }

  get selectedPresetDisabledReason(): string | null {
    if (this.activeWorkflowTab !== 'presets') {
      return null;
    }
    const selectedPreset = this.selectedPresetDefinition;
    if (!selectedPreset) {
      return 'Select a preset.';
    }
    return this.getPresetDisabledReason(selectedPreset);
  }

  get isSaveDisabled(): boolean {
    if (this.isSaving) {
      return true;
    }
    if (this.mode === 'edit' && this.editTileOrder === null) {
      return true;
    }
    if (this.activeWorkflowTab === 'presets') {
      return this.selectedPresetDisabledReason !== null;
    }
    if (this.category === 'curated' && this.isCuratedOptionDisabled(this.curatedChartType)) {
      return true;
    }
    if (this.category === 'kpi' && this.isKpiOptionDisabled(this.kpiChartType)) {
      return true;
    }
    if (this.category === 'map' && this.isMapOptionDisabled()) {
      return true;
    }
    return false;
  }

  get isAddDefaultsDisabled(): boolean {
    return this.isSaving || this.getMissingDefaultDashboardTiles().length === 0;
  }

  get isAddAllDisabled(): boolean {
    return this.isSaving || this.getMissingAllDashboardTiles().length === 0;
  }

  get isRemoveAllDisabled(): boolean {
    return this.isSaving || this.dashboardTiles.length === 0;
  }

  get isSaveSaving(): boolean {
    return this.savingAction === 'save';
  }

  get isAddDefaultsSaving(): boolean {
    return this.savingAction === 'addDefaults';
  }

  get isAddAllSaving(): boolean {
    return this.savingAction === 'addAll';
  }

  get isRemoveAllSaving(): boolean {
    return this.savingAction === 'removeAll';
  }

  onModeChange(nextMode: 'add' | 'edit'): void {
    this.hapticsService.selection();
    this.mode = nextMode;
    this.saveError = '';

    if (nextMode === 'edit') {
      const editTarget = this.resolveEditTile();
      if (editTarget) {
        this.syncFormStateFromTile(editTarget);
      }
      this.ensurePresetSelection();
      return;
    }

    this.category = 'custom';
    this.resetCustomEventFilters();
    this.resetMapEventFilters();
    this.ensurePresetSelection();
  }

  onWorkflowTabChange(nextIndex: number): void {
    this.hapticsService.selection();
    this.activeWorkflowTab = nextIndex === 1 ? 'presets' : 'manual';
    this.saveError = '';
    this.ensurePresetSelection();
  }

  onEditTileSelectionChange(nextOrder: number): void {
    this.hapticsService.selection();
    this.editTileOrder = Number(nextOrder);
    const editTarget = this.resolveEditTile();
    if (!editTarget) {
      this.ensurePresetSelection();
      return;
    }
    this.syncFormStateFromTile(editTarget);
    this.ensurePresetSelection();
  }

  onCategoryChange(nextCategory: DashboardManagerCategory): void {
    this.hapticsService.selection();
    this.category = nextCategory;
    this.saveError = '';

    if (nextCategory === 'curated') {
      const availableCurated = this.curatedChartDefinitions.find(def => !this.isCuratedOptionDisabled(def.chartType));
      if (availableCurated) {
        this.curatedChartType = availableCurated.chartType;
      }
      return;
    }

    if (nextCategory === 'kpi') {
      const availableKpi = this.filteredKpiChartDefinitions.find(def => !this.isKpiOptionDisabled(def.chartType));
      if (availableKpi) {
        this.kpiChartType = availableKpi.chartType;
      }
      return;
    }

    if (nextCategory === 'custom') {
      const editTile = this.resolveEditTile();
      if (editTile?.type === TileTypes.Chart && !isDashboardSpecialChartType((editTile as TileChartSettingsInterface).chartType)) {
        this.syncFormStateFromTile(editTile);
      } else {
        this.resetCustomEventFilters();
      }
      return;
    }

    if (nextCategory === 'map') {
      const editTile = this.resolveEditTile();
      if (editTile?.type === TileTypes.Map) {
        this.syncFormStateFromTile(editTile);
      } else {
        this.resetMapEventFilters();
      }
    }
  }

  onPresetCategoryChange(nextCategory: DashboardManagerPresetCategory): void {
    this.hapticsService.selection();
    this.presetCategory = nextCategory;
    this.saveError = '';
    this.ensurePresetSelection(true);
  }

  onKpiGroupChange(nextGroup: DashboardKpiGroup): void {
    this.hapticsService.selection();
    this.kpiGroup = nextGroup;
    this.saveError = '';
    const nextAvailable = this.filteredKpiChartDefinitions.find(def => !this.isKpiOptionDisabled(def.chartType));
    if (nextAvailable) {
      this.kpiChartType = nextAvailable.chartType;
    }
  }

  onPresetKpiGroupChange(nextGroup: DashboardKpiGroup): void {
    this.hapticsService.selection();
    this.presetKpiGroup = nextGroup;
    this.saveError = '';
    this.ensurePresetSelection(true);
  }

  onPresetSelectionChange(nextPresetId: DashboardManagerPresetId): void {
    this.hapticsService.selection();
    this.selectedPresetId = nextPresetId;
    this.saveError = '';
  }

  isPresetDisabled(definition: DashboardManagerPresetDefinition): boolean {
    return this.getPresetDisabledReason(definition) !== null;
  }

  getPresetDisabledReason(definition: DashboardManagerPresetDefinition): string | null {
    if (definition.category === 'curated' && this.isCuratedOptionDisabled(definition.curatedChartType)) {
      return 'Already on dashboard.';
    }

    if (definition.category === 'kpi' && this.isKpiOptionDisabled(definition.kpiChartType)) {
      return 'Already on dashboard.';
    }

    if (definition.category === 'map' && this.isMapOptionDisabled()) {
      return 'Map tile already exists.';
    }

    return null;
  }

  onCustomChartTypeChange(nextChartType: ChartTypes): void {
    this.hapticsService.selection();
    this.customChartType = nextChartType;
    if (nextChartType === ChartTypes.Pie) {
      this.customDataValueType = ChartDataValueTypes.Total;
    }
  }

  async onCustomEventRangeChange(nextRange: AppDashboardTileEventFilterRange): Promise<void> {
    const previousRange = this.customEventRange;
    if (nextRange === 'all') {
      const confirmed = await this.confirmAllTileEventRangeSelection();
      if (!confirmed) {
        this.customEventRange = previousRange;
        return;
      }
    }
    this.hapticsService.selection();
    this.customEventRange = nextRange;
  }

  onCustomEventActivityTypesChange(activityTypes: ActivityTypes[]): void {
    this.hapticsService.selection();
    this.customEventActivityTypes = activityTypes || [];
  }

  async onMapEventRangeChange(nextRange: AppDashboardTileEventFilterRange): Promise<void> {
    const previousRange = this.mapEventRange;
    if (nextRange === 'all') {
      const confirmed = await this.confirmAllTileEventRangeSelection();
      if (!confirmed) {
        this.mapEventRange = previousRange;
        return;
      }
    }
    this.hapticsService.selection();
    this.mapEventRange = nextRange;
  }

  onMapEventActivityTypesChange(activityTypes: ActivityTypes[]): void {
    this.hapticsService.selection();
    this.mapEventActivityTypes = activityTypes || [];
  }

  isCuratedOptionDisabled(chartType: DashboardCuratedChartType): boolean {
    const editedOrder = this.mode === 'edit' ? this.editTileOrder : null;
    return this.chartTiles.some((tile) => (
      this.isTileForCuratedChartType(tile, chartType)
      && (editedOrder === null || tile.order !== editedOrder)
    ));
  }

  isKpiOptionDisabled(chartType: DashboardKpiChartType): boolean {
    const editedOrder = this.mode === 'edit' ? this.editTileOrder : null;
    return this.chartTiles.some((tile) => (
      `${tile.chartType}` === `${chartType}`
      && (editedOrder === null || tile.order !== editedOrder)
    ));
  }

  isMapOptionDisabled(): boolean {
    const editedOrder = this.mode === 'edit' ? this.editTileOrder : null;
    return this.dashboardTiles.some((tile) => (
      tile.type === TileTypes.Map
      && (editedOrder === null || tile.order !== editedOrder)
    ));
  }

  getEditTileLabel(tile: TileSettingsInterface): string {
    const tileName = `${tile.name || ''}`.trim();
    const tileKindLabel = tile.type === TileTypes.Map ? 'Map' : 'Chart';
    const fallbackName = tile.type === TileTypes.Map
      ? 'Map'
      : `${(tile as TileChartSettingsInterface).chartType || 'Chart'}`;
    const displayName = tileName || fallbackName;
    return `${displayName} (${tileKindLabel} #${tile.order + 1})`;
  }

  close(): void {
    this.hapticsService.selection();
    this.dialogRef.close({ saved: this.hasSavedChanges });
  }

  async save(): Promise<void> {
    if (this.isSaveDisabled) {
      return;
    }

    this.startSaving('save');
    this.saveError = '';
    const dashboardSettings = this.data.user.settings.dashboardSettings;
    const previousSettings = this.snapshotDashboardSettings(dashboardSettings);

    try {
      const clonedTiles = this.cloneTiles(dashboardSettings.tiles || []);

      if (this.mode === 'add') {
        const defaultSizeForAdd = this.resolveDefaultAddTileSize();
        const newTile = this.activeWorkflowTab === 'presets'
          ? this.buildPresetTileForMode(clonedTiles.length, defaultSizeForAdd)
          : this.buildTileForMode(clonedTiles.length, defaultSizeForAdd, null);
        if (!newTile) {
          this.stopSaving();
          return;
        }
        clonedTiles.push(newTile);
      } else {
        const editTile = this.resolveEditTile();
        if (!editTile) {
          this.saveError = 'Select a tile to edit.';
          this.stopSaving();
          return;
        }

        const editIndex = clonedTiles.findIndex(tile => tile.order === editTile.order);
        if (editIndex < 0) {
          this.saveError = 'Could not find the selected tile.';
          this.stopSaving();
          return;
        }

        const replacement = this.activeWorkflowTab === 'presets'
          ? this.buildPresetTileForMode(editTile.order, editTile.size || { columns: 1, rows: 1 }, editTile)
          : this.buildTileForMode(editTile.order, editTile.size || { columns: 1, rows: 1 }, editTile);
        if (!replacement) {
          this.stopSaving();
          return;
        }

        clonedTiles[editIndex] = replacement;
      }

      if (this.hasDuplicateSpecialTiles(clonedTiles)) {
        this.saveError = 'Derived curated and KPI chart types can only be added once each.';
        this.stopSaving();
        return;
      }

      if (this.hasDuplicateMapTiles(clonedTiles)) {
        this.saveError = 'Map tile can only be added once.';
        this.stopSaving();
        return;
      }

      dashboardSettings.tiles = clonedTiles;
      if (dashboardSettings.tiles.some(tile => tile.type === TileTypes.Chart && isDashboardRecoveryNowChartType((tile as TileChartSettingsInterface).chartType))) {
        dashboardSettings.dismissedCuratedRecoveryNowTile = false;
      }
      this.syncAutoTileStateAfterSave(dashboardSettings, previousSettings.tiles, clonedTiles);

      await this.persistDashboardSettings(dashboardSettings);
      this.hasSavedChanges = true;
      this.hapticsService.success();
      this.dialogRef.close({ saved: true });
    } catch (error) {
      this.rollbackDashboardSettings(dashboardSettings, previousSettings);
      this.handleDashboardSettingsSaveError(error);
    } finally {
      this.stopSaving();
    }
  }

  async addDefaultTiles(): Promise<void> {
    if (this.isAddDefaultsDisabled) {
      return;
    }

    this.hapticsService.selection();
    this.startSaving('addDefaults');
    this.saveError = '';
    const dashboardSettings = this.data.user.settings.dashboardSettings;
    const previousSettings = this.snapshotDashboardSettings(dashboardSettings);

    try {
      await this.refreshSleepEligibilityForAddAll();
      const clonedTiles = this.cloneTiles(dashboardSettings.tiles || []);
      const missingTiles = this.getMissingDefaultDashboardTiles(clonedTiles);
      if (!missingTiles.length) {
        this.saveError = 'Default dashboard tiles are already on your dashboard.';
        this.stopSaving();
        return;
      }

      const bulkAppendError = this.appendBulkTiles(clonedTiles, missingTiles);
      if (bulkAppendError) {
        this.saveError = bulkAppendError;
        this.stopSaving();
        return;
      }

      dashboardSettings.tiles = clonedTiles;
      this.syncAutoTileStateAfterSave(dashboardSettings, previousSettings.tiles, clonedTiles);
      await this.persistDashboardSettings(dashboardSettings);
      this.hasSavedChanges = true;
      this.hapticsService.success();
      this.dialogRef.close({ saved: true });
    } catch (error) {
      this.rollbackDashboardSettings(dashboardSettings, previousSettings);
      this.handleDashboardSettingsSaveError(error);
    } finally {
      this.stopSaving();
    }
  }

  async addAllTiles(): Promise<void> {
    if (this.isAddAllDisabled) {
      return;
    }

    this.hapticsService.selection();
    this.startSaving('addAll');
    this.saveError = '';
    const dashboardSettings = this.data.user.settings.dashboardSettings;
    const previousSettings = this.snapshotDashboardSettings(dashboardSettings);

    try {
      await this.refreshSleepEligibilityForAddAll();
      const clonedTiles = this.cloneTiles(dashboardSettings.tiles || []);
      const missingTiles = this.getMissingAllDashboardTiles(clonedTiles);
      if (!missingTiles.length) {
        this.saveError = 'All available dashboard tiles are already on your dashboard.';
        this.stopSaving();
        return;
      }

      const bulkAppendError = this.appendBulkTiles(clonedTiles, missingTiles);
      if (bulkAppendError) {
        this.saveError = bulkAppendError;
        this.stopSaving();
        return;
      }

      dashboardSettings.tiles = clonedTiles;
      this.syncAutoTileStateAfterSave(dashboardSettings, previousSettings.tiles, clonedTiles);
      await this.persistDashboardSettings(dashboardSettings);
      this.hasSavedChanges = true;
      this.hapticsService.success();
      this.dialogRef.close({ saved: true });
    } catch (error) {
      this.rollbackDashboardSettings(dashboardSettings, previousSettings);
      this.handleDashboardSettingsSaveError(error);
    } finally {
      this.stopSaving();
    }
  }

  async removeAllTiles(): Promise<void> {
    if (this.isRemoveAllDisabled) {
      return;
    }

    this.hapticsService.selection();
    const confirmed = await this.confirmRemoveAllTiles();
    if (!confirmed) {
      return;
    }

    this.startSaving('removeAll');
    this.saveError = '';
    const dashboardSettings = this.data.user.settings.dashboardSettings;
    const previousSettings = this.snapshotDashboardSettings(dashboardSettings);

    try {
      dashboardSettings.tiles = [];
      this.markAllDashboardAutoTilesDismissed(dashboardSettings, Date.now());
      dashboardSettings.dismissedCuratedRecoveryNowTile = true;
      await this.persistDashboardSettings(dashboardSettings);
      this.hasSavedChanges = true;
      this.mode = 'add';
      this.editTileOrder = null;
      this.ensurePresetSelection(true);
      this.hapticsService.success();
      this.dialogRef.close({ saved: true });
    } catch (error) {
      this.rollbackDashboardSettings(dashboardSettings, previousSettings);
      this.handleDashboardSettingsSaveError(error);
    } finally {
      this.stopSaving();
    }
  }

  private startSaving(action: Exclude<DashboardManagerSavingAction, null>): void {
    this.isSaving = true;
    this.savingAction = action;
  }

  private stopSaving(): void {
    this.isSaving = false;
    this.savingAction = null;
  }

  private resolveEditTile(): TileSettingsInterface | null {
    if (this.editTileOrder === null) {
      return null;
    }
    return this.dashboardTiles.find(tile => tile.order === this.editTileOrder) || null;
  }

  private syncFormStateFromTile(tile: TileSettingsInterface): void {
    if (tile.type === TileTypes.Map) {
      const mapTile = tile as DashboardMapTileSettings;
      this.category = 'map';
      this.mapStyle = this.normalizeMapStyle(mapTile.mapStyle);
      this.mapClusterMarkers = mapTile.clusterMarkers !== false;
      const mapFilters = normalizeDashboardTileEventFilters((mapTile as AppDashboardMapTileSettingsInterface).eventFilters);
      this.mapEventRange = mapFilters.range;
      this.mapEventActivityTypes = mapFilters.activityTypes || [];
      return;
    }

    const chartTile = tile as TileChartSettingsInterface;
    this.category = resolveDashboardChartCategory(chartTile.chartType);

    if (isDashboardCuratedChartType(chartTile.chartType)) {
      this.curatedChartType = chartTile.chartType;
      return;
    }

    if (isDashboardKpiChartType(chartTile.chartType)) {
      this.kpiChartType = chartTile.chartType;
      this.kpiGroup = this.resolveKpiGroupForChartType(chartTile.chartType);
      this.presetKpiGroup = this.kpiGroup;
      return;
    }

    this.customChartType = chartTile.chartType;
    this.customDataType = chartTile.dataType;
    this.customDataValueType = chartTile.dataValueType;
    this.customDataCategoryType = chartTile.dataCategoryType;
    this.customTimeInterval = chartTile.dataTimeInterval || TimeIntervals.Auto;
    const customFilters = normalizeDashboardTileEventFilters((chartTile as AppDashboardChartTileSettingsInterface).eventFilters);
    this.customEventRange = customFilters.range;
    this.customEventActivityTypes = customFilters.activityTypes || [];
  }

  private cloneTiles(tiles: TileSettingsInterface[]): TileSettingsInterface[] {
    return (tiles || []).map((tile: TileSettingsInterface) => {
      const clonedTile = {
        ...tile,
        size: tile.size ? { ...tile.size } : tile.size,
      } as TileSettingsInterface & {
        eventFilters?: AppDashboardTileEventFiltersInterface;
        displaySettings?: AppDashboardChartTileDisplaySettingsInterface;
      };
      const eventFilters = cloneDashboardTileEventFilters(
        (tile as AppDashboardChartTileSettingsInterface | AppDashboardMapTileSettingsInterface).eventFilters,
      );
      if (eventFilters) {
        clonedTile.eventFilters = eventFilters;
      } else {
        delete clonedTile.eventFilters;
      }
      if (tile.type === TileTypes.Chart) {
        const chartTile = tile as AppDashboardChartTileSettingsInterface;
        const displaySettings = cloneDashboardChartTileDisplaySettingsForChartType(
          chartTile.chartType,
          chartTile.displaySettings,
        );
        if (displaySettings) {
          clonedTile.displaySettings = displaySettings;
        } else {
          delete clonedTile.displaySettings;
        }
      }
      return clonedTile as TileSettingsInterface;
    });
  }

  private cloneAutoTiles(
    autoTiles: Partial<Record<string, AppDashboardAutoTileState>>,
  ): Partial<Record<string, AppDashboardAutoTileState>> {
    return Object.entries(autoTiles).reduce<Partial<Record<string, AppDashboardAutoTileState>>>((cloned, [id, state]) => {
      if (state) {
        cloned[id] = { ...state };
      }
      return cloned;
    }, {});
  }

  private snapshotDashboardSettings(
    dashboardSettings: AppDashboardSettingsInterface,
  ): DashboardManagerSettingsSnapshot {
    return {
      tiles: this.cloneTiles(dashboardSettings.tiles || []),
      dismissedCuratedRecoveryNowTile: dashboardSettings.dismissedCuratedRecoveryNowTile,
      autoTiles: this.cloneAutoTiles(dashboardSettings.autoTiles || {}),
    };
  }

  private rollbackDashboardSettings(
    dashboardSettings: AppDashboardSettingsInterface,
    previousSettings: DashboardManagerSettingsSnapshot,
  ): void {
    dashboardSettings.tiles = this.cloneTiles(previousSettings.tiles);
    dashboardSettings.dismissedCuratedRecoveryNowTile = previousSettings.dismissedCuratedRecoveryNowTile;
    dashboardSettings.autoTiles = previousSettings.autoTiles as AppDashboardSettingsInterface['autoTiles'];
  }

  private handleDashboardSettingsSaveError(error: unknown): void {
    this.saveError = 'Could not save dashboard tile settings.';
    this.hapticsService.error();
    console.error('[DashboardManagerDialogComponent] Failed to save dashboard tile settings', error);
  }

  private async persistDashboardSettings(dashboardSettings: AppDashboardSettingsInterface): Promise<void> {
    const dashboardSettingsPatch: Partial<AppDashboardSettingsInterface> = {
      tiles: dashboardSettings.tiles || [],
    };
    if (dashboardSettings.autoTiles !== undefined) {
      dashboardSettingsPatch.autoTiles = dashboardSettings.autoTiles;
    }
    if (dashboardSettings.dismissedCuratedRecoveryNowTile !== undefined) {
      dashboardSettingsPatch.dismissedCuratedRecoveryNowTile = dashboardSettings.dismissedCuratedRecoveryNowTile;
    }

    await this.userService.updateUserProperties(this.data.user, {
      settings: {
        dashboardSettings: dashboardSettingsPatch,
      },
    });
  }

  private syncSleepTrendAutoTileStateAfterSave(
    dashboardSettings: AppDashboardSettingsInterface,
    previousTiles: TileSettingsInterface[],
    nextTiles: TileSettingsInterface[],
    nowMs: number,
  ): void {
    const previousHadSleepTrend = previousTiles.some(tile => isDashboardSleepTrendTile(tile));
    const nextHasSleepTrend = nextTiles.some(tile => isDashboardSleepTrendTile(tile));
    const currentSleepTrendState = dashboardSettings.autoTiles?.[DASHBOARD_AUTO_TILE_SLEEP_TREND_ID]?.state;

    if (nextHasSleepTrend && (!previousHadSleepTrend || currentSleepTrendState === 'dismissed')) {
      markDashboardAutoTileAdded(
        dashboardSettings,
        DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
        DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
        nowMs,
      );
      return;
    }

    if (!nextHasSleepTrend && previousHadSleepTrend) {
      markDashboardAutoTileDismissed(
        dashboardSettings,
        DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
        DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
        nowMs,
      );
    }
  }

  private syncChartBackedAutoTileStatesAfterSave(
    dashboardSettings: AppDashboardSettingsInterface,
    previousTiles: TileSettingsInterface[],
    nextTiles: TileSettingsInterface[],
    nowMs: number,
  ): void {
    const previousDescriptors = previousTiles
      .map(tile => getDashboardAutoTileDescriptorForTile(tile))
      .filter((descriptor): descriptor is DashboardAutoTileDescriptor => !!descriptor);
    const nextDescriptors = nextTiles
      .map(tile => getDashboardAutoTileDescriptorForTile(tile))
      .filter((descriptor): descriptor is DashboardAutoTileDescriptor => !!descriptor);

    nextDescriptors.forEach((descriptor) => {
      if (descriptor.id === DASHBOARD_AUTO_TILE_SLEEP_TREND_ID) {
        return;
      }
      const wasPresent = previousDescriptors.some(previous => previous.id === descriptor.id);
      const currentState = dashboardSettings.autoTiles?.[descriptor.id]?.state;
      if (!wasPresent || currentState === 'dismissed') {
        markDashboardAutoTileAdded(dashboardSettings, descriptor.id, descriptor.source, nowMs);
        if (descriptor.id === DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID) {
          dashboardSettings.dismissedCuratedRecoveryNowTile = false;
        }
      }
    });

    previousDescriptors.forEach((descriptor) => {
      if (descriptor.id === DASHBOARD_AUTO_TILE_SLEEP_TREND_ID) {
        return;
      }
      const isPresent = nextDescriptors.some(next => next.id === descriptor.id);
      if (!isPresent) {
        markDashboardAutoTileDismissed(dashboardSettings, descriptor.id, descriptor.source, nowMs);
        if (descriptor.id === DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID) {
          dashboardSettings.dismissedCuratedRecoveryNowTile = true;
        }
      }
    });
  }

  private syncAutoTileStateAfterSave(
    dashboardSettings: AppDashboardSettingsInterface,
    previousTiles: TileSettingsInterface[],
    nextTiles: TileSettingsInterface[],
  ): void {
    const nowMs = Date.now();
    this.syncSleepTrendAutoTileStateAfterSave(dashboardSettings, previousTiles, nextTiles, nowMs);
    this.syncChartBackedAutoTileStatesAfterSave(dashboardSettings, previousTiles, nextTiles, nowMs);
  }

  private buildTileForMode(
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileSettingsInterface | null,
  ): TileSettingsInterface | null {
    if (this.category === 'map') {
      if (this.isMapOptionDisabled()) {
        this.saveError = 'Map tile can only be added once.';
        return null;
      }
      return this.buildMapTile(order, size, existingTile);
    }

    if (this.category === 'curated') {
      if (this.isCuratedOptionDisabled(this.curatedChartType)) {
        this.saveError = 'This curated chart already exists.';
        return null;
      }
      return this.buildCuratedTile(this.curatedChartType, order, size, existingTile);
    }

    if (this.category === 'kpi') {
      if (this.isKpiOptionDisabled(this.kpiChartType)) {
        this.saveError = 'This KPI chart already exists.';
        return null;
      }
      return this.buildKpiTile(this.kpiChartType, order, size);
    }

    return this.buildCustomTile(order, size, existingTile);
  }

  private buildPresetTileForMode(
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileSettingsInterface | null = null,
  ): TileSettingsInterface | null {
    const selectedPreset = this.selectedPresetDefinition;
    if (!selectedPreset) {
      this.saveError = 'Select a preset.';
      return null;
    }

    const disabledReason = this.getPresetDisabledReason(selectedPreset);
    if (disabledReason) {
      this.saveError = disabledReason;
      return null;
    }

    const tile = buildDashboardManagerPresetTile({
      presetId: selectedPreset.id,
      order,
      size,
    });
    return this.mergeExistingDisplaySettingsForSameChart(tile, existingTile);
  }

  private buildCuratedTile(
    chartType: DashboardCuratedChartType,
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileSettingsInterface | null,
  ): TileChartSettingsInterface {
    let tile: TileChartSettingsInterface;
    if (chartType === DASHBOARD_SLEEP_TREND_CHART_TYPE) {
      tile = buildDashboardSleepTrendAutoTile(order, size);
    } else {
      tile = buildDashboardCuratedAutoTile(chartType as DashboardDefaultCuratedChartType, order, size);
    }

    return this.mergeExistingDisplaySettingsForSameChart(tile, existingTile) as TileChartSettingsInterface;
  }

  private buildKpiTile(
    chartType: DashboardKpiChartType,
    order: number,
    size: { columns: number; rows: number },
  ): TileChartSettingsInterface {
    return buildDashboardKpiAutoTile(chartType, order, size);
  }

  private mergeExistingDisplaySettingsForSameChart(
    tile: TileSettingsInterface | null,
    existingTile: TileSettingsInterface | null,
  ): TileSettingsInterface | null {
    if (!tile || tile.type !== TileTypes.Chart || existingTile?.type !== TileTypes.Chart) {
      return tile;
    }
    const nextChartTile = tile as AppDashboardChartTileSettingsInterface;
    const existingChartTile = existingTile as AppDashboardChartTileSettingsInterface;
    if (`${nextChartTile.chartType}` !== `${existingChartTile.chartType}`) {
      return tile;
    }

    const defaultDisplaySettings = normalizeDashboardChartTileDisplaySettingsForChartType(
      nextChartTile.chartType,
      nextChartTile.displaySettings,
      true,
    );
    const existingDisplaySettings = normalizeDashboardChartTileDisplaySettingsForChartType(
      nextChartTile.chartType,
      existingChartTile.displaySettings,
      false,
    );
    const mergedDisplaySettings = {
      ...(defaultDisplaySettings || {}),
      ...(existingDisplaySettings || {}),
    };
    if (Object.keys(mergedDisplaySettings).length > 0) {
      nextChartTile.displaySettings = mergedDisplaySettings;
    } else {
      delete nextChartTile.displaySettings;
    }
    if (isDashboardEventBackedSpecialChartType(nextChartTile.chartType)) {
      nextChartTile.eventFilters = cloneDashboardTileEventFilters(existingChartTile.eventFilters)
        || cloneDashboardTileEventFilters(nextChartTile.eventFilters);
    }
    return nextChartTile;
  }

  private buildMapTile(
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileSettingsInterface | null,
  ): DashboardMapTileSettings {
    const defaultMapTile = AppUserUtilities.getDefaultUserDashboardMapTile() as DashboardMapTileSettings;
    const existingMapTile = existingTile?.type === TileTypes.Map ? existingTile as DashboardMapTileSettings : null;
    const existingName = `${existingMapTile?.name || ''}`.trim();

    return {
      ...defaultMapTile,
      ...existingMapTile,
      name: existingName || `${defaultMapTile.name || 'Map'}`,
      type: TileTypes.Map,
      order,
      size,
      mapStyle: this.mapStyle,
      clusterMarkers: this.mapClusterMarkers,
      mapTheme: existingMapTile?.mapTheme ?? defaultMapTile.mapTheme,
      showHeatMap: existingMapTile?.showHeatMap ?? defaultMapTile.showHeatMap,
      eventFilters: this.buildTileEventFilters(this.mapEventRange, this.mapEventActivityTypes),
    };
  }

  private buildCustomTile(
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileSettingsInterface | null,
  ): AppDashboardChartTileSettingsInterface {
    const existingChartTile = existingTile?.type === TileTypes.Chart ? existingTile as TileChartSettingsInterface : null;
    const isIntensityZones = this.customChartType === ChartTypes.IntensityZones;
    const isPie = this.customChartType === ChartTypes.Pie;
    const fallbackName = isIntensityZones ? 'Intensity Zones' : `${this.customDataType || 'Custom chart'}`;

    return {
      name: `${existingChartTile?.name || ''}`.trim() || fallbackName,
      type: TileTypes.Chart,
      order,
      size,
      chartType: this.customChartType,
      dataType: this.customDataType,
      dataValueType: isPie ? ChartDataValueTypes.Total : this.customDataValueType,
      dataCategoryType: this.customDataCategoryType,
      dataTimeInterval: this.customTimeInterval,
      eventFilters: this.buildTileEventFilters(this.customEventRange, this.customEventActivityTypes),
    };
  }

  private buildTileEventFilters(
    range: AppDashboardTileEventFilterRange,
    activityTypes: ActivityTypes[],
  ): AppDashboardTileEventFiltersInterface {
    return normalizeDashboardTileEventFilters({
      range,
      activityTypes: activityTypes || [],
    });
  }

  private resetCustomEventFilters(): void {
    const defaultFilters = AppUserUtilities.getDefaultDashboardTileEventFilters();
    this.customEventRange = defaultFilters.range || DASHBOARD_TILE_EVENT_DEFAULT_RANGE;
    this.customEventActivityTypes = [...(defaultFilters.activityTypes || [])];
  }

  private resetMapEventFilters(): void {
    const defaultFilters = AppUserUtilities.getDefaultDashboardTileEventFilters();
    this.mapEventRange = defaultFilters.range || DASHBOARD_TILE_EVENT_DEFAULT_RANGE;
    this.mapEventActivityTypes = [...(defaultFilters.activityTypes || [])];
  }

  private async confirmAllTileEventRangeSelection(): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Load all tile events?',
        message: 'Selecting All may degrade app performance and increase loading times. Continue?',
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      },
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed().pipe(take(1)));
    return confirmed === true;
  }

  private async confirmRemoveAllTiles(): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Remove all dashboard tiles?',
        message: 'This clears every chart and map tile from your dashboard. Automatic dashboard suggestions will also stay dismissed until you add them again.',
        confirmLabel: 'Remove all',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      },
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed().pipe(take(1)));
    return confirmed === true;
  }

  private getMissingDefaultDashboardTiles(
    tiles: TileSettingsInterface[] = this.dashboardTiles,
  ): TileSettingsInterface[] {
    const defaultTiles = AppUserUtilities.getDefaultUserDashboardTiles();
    if (this.hasSleepDataForAddAll) {
      defaultTiles.push(buildDashboardSleepTrendAutoTile(defaultTiles.length));
    }
    return defaultTiles.filter(defaultTile => !tiles.some(tile => this.isTileForBulkDashboardTile(tile, defaultTile)));
  }

  private getMissingAllDashboardTiles(
    tiles: TileSettingsInterface[] = this.dashboardTiles,
  ): TileSettingsInterface[] {
    const allTiles = this.getAllDashboardManagerPresetTiles();
    return allTiles.filter(candidateTile => !tiles.some(tile => this.isTileForBulkDashboardTile(tile, candidateTile)));
  }

  private getAllDashboardManagerPresetTiles(): TileSettingsInterface[] {
    return getDashboardManagerPresetDefinitions()
      .filter(definition => (
        definition.category !== 'curated'
        || definition.curatedChartType !== DASHBOARD_SLEEP_TREND_CHART_TYPE
        || this.hasSleepDataForAddAll
      ))
      .map((definition, index) => buildDashboardManagerPresetTile({
        presetId: definition.id,
        order: index,
        size: this.resolveDefaultAddTileSize(),
      }));
  }

  private isTileForBulkDashboardTile(
    tile: TileSettingsInterface,
    defaultTile: TileSettingsInterface,
  ): boolean {
    if (defaultTile.type === TileTypes.Map) {
      return tile.type === TileTypes.Map;
    }

    if (tile.type !== TileTypes.Chart || defaultTile.type !== TileTypes.Chart) {
      return false;
    }

    if (isDashboardSleepTrendTile(defaultTile)) {
      return isDashboardSleepTrendTile(tile);
    }

    const defaultDescriptor = getDashboardAutoTileDescriptorForTile(defaultTile);
    if (defaultDescriptor) {
      return getDashboardAutoTileDescriptorForTile(tile)?.id === defaultDescriptor.id;
    }

    const chartTile = tile as TileChartSettingsInterface;
    const defaultChartTile = defaultTile as TileChartSettingsInterface;
    return `${chartTile.chartType}` === `${defaultChartTile.chartType}`
      && chartTile.dataType === defaultChartTile.dataType
      && chartTile.dataValueType === defaultChartTile.dataValueType
      && chartTile.dataCategoryType === defaultChartTile.dataCategoryType
      && chartTile.dataTimeInterval === defaultChartTile.dataTimeInterval;
  }

  private appendBulkTiles(
    targetTiles: TileSettingsInterface[],
    missingTiles: TileSettingsInterface[],
  ): string | null {
    let nextOrder = this.resolveNextTileOrder(targetTiles);
    missingTiles.forEach((tile) => {
      targetTiles.push(this.cloneTileForAddAll(tile, nextOrder));
      nextOrder += 1;
    });

    if (this.hasDuplicateSpecialTiles(targetTiles)) {
      return 'Derived curated and KPI chart types can only be added once each.';
    }

    if (this.hasDuplicateMapTiles(targetTiles)) {
      return 'Map tile can only be added once.';
    }

    return null;
  }

  private cloneTileForAddAll(tile: TileSettingsInterface, order: number): TileSettingsInterface {
    const clonedTile = this.cloneTiles([tile])[0];
    return {
      ...clonedTile,
      order,
      size: clonedTile.size ? { ...clonedTile.size } : this.resolveDefaultAddTileSize(),
    };
  }

  private resolveNextTileOrder(tiles: readonly TileSettingsInterface[]): number {
    if (!tiles.length) {
      return 0;
    }
    return Math.max(...tiles.map(tile => Number(tile?.order || 0))) + 1;
  }

  private watchSleepEligibilityForAddAll(): void {
    this.sleepEligibilitySubscription.unsubscribe();
    this.sleepEligibilitySubscription = new Subscription();
    this.hasSleepDataForAddAll = false;
    const uid = `${this.data?.user?.uid || ''}`.trim();
    if (!uid) {
      return;
    }

    this.sleepEligibilitySubscription = this.sleepService.watchHasAnySleepSession(uid).subscribe({
      next: (hasSleepData) => {
        this.hasSleepDataForAddAll = hasSleepData === true;
      },
      error: () => {
        this.hasSleepDataForAddAll = false;
      },
    });
  }

  private async refreshSleepEligibilityForAddAll(): Promise<void> {
    const uid = `${this.data?.user?.uid || ''}`.trim();
    if (!uid) {
      this.hasSleepDataForAddAll = false;
      return;
    }

    try {
      this.hasSleepDataForAddAll = await firstValueFrom(
        this.sleepService.watchHasAnySleepSession(uid).pipe(take(1)),
      ) === true;
    } catch {
      this.hasSleepDataForAddAll = false;
    }
  }

  private markAllDashboardAutoTilesDismissed(
    dashboardSettings: AppDashboardSettingsInterface,
    nowMs: number,
  ): void {
    markDashboardAutoTileDismissed(
      dashboardSettings,
      DASHBOARD_AUTO_TILE_SLEEP_TREND_ID,
      DASHBOARD_AUTO_TILE_SLEEP_TREND_SOURCE,
      nowMs,
    );

    Object.values(DASHBOARD_AUTO_TILE_CURATED_ID_BY_CHART_TYPE).forEach((id) => {
      markDashboardAutoTileDismissed(
        dashboardSettings,
        id,
        id === DASHBOARD_AUTO_TILE_POWER_CURVE_ID
          ? DASHBOARD_AUTO_TILE_POWER_CURVE_SOURCE
          : DASHBOARD_AUTO_TILE_CURATED_SOURCE,
        nowMs,
      );
    });

    Object.values(DASHBOARD_AUTO_TILE_KPI_ID_BY_CHART_TYPE).forEach((id) => {
      markDashboardAutoTileDismissed(dashboardSettings, id, DASHBOARD_AUTO_TILE_KPI_SOURCE, nowMs);
    });
  }

  private hasDuplicateSpecialTiles(tiles: TileSettingsInterface[]): boolean {
    const seen = new Set<string>();
    for (const tile of tiles) {
      if (tile.type !== TileTypes.Chart) {
        continue;
      }
      const chartTile = tile as TileChartSettingsInterface;
      const uniquenessKey = this.getSpecialTileUniquenessKey(chartTile);
      if (!uniquenessKey) {
        continue;
      }
      if (seen.has(uniquenessKey)) {
        return true;
      }
      seen.add(uniquenessKey);
    }
    return false;
  }

  private isTileForCuratedChartType(
    tile: TileChartSettingsInterface,
    chartType: DashboardCuratedChartType,
  ): boolean {
    if (chartType === DASHBOARD_RECOVERY_NOW_CHART_TYPE) {
      return getDashboardAutoTileDescriptorForTile(tile)?.id === DASHBOARD_AUTO_TILE_RECOVERY_NOW_ID;
    }

    return `${tile.chartType}` === `${chartType}`;
  }

  private getSpecialTileUniquenessKey(tile: TileChartSettingsInterface): string | null {
    const descriptor = getDashboardAutoTileDescriptorForTile(tile);
    if (descriptor) {
      return descriptor.id;
    }
    return isDashboardSpecialChartType(tile.chartType) ? `${tile.chartType}` : null;
  }

  private resolveDefaultAddTileSize(): { columns: number; rows: number } {
    return { columns: 1, rows: 1 };
  }

  private resolveKpiGroupForChartType(chartType: DashboardKpiChartType): DashboardKpiGroup {
    return this.kpiChartDefinitions.find(definition => definition.chartType === chartType)?.group || 'load';
  }

  private hasDuplicateMapTiles(tiles: TileSettingsInterface[]): boolean {
    let mapTileCount = 0;
    for (const tile of tiles) {
      if (tile.type !== TileTypes.Map) {
        continue;
      }
      mapTileCount += 1;
      if (mapTileCount > 1) {
        return true;
      }
    }
    return false;
  }

  private ensurePresetSelection(forceCategoryFallback = false): void {
    const presetsForCategory = this.filteredPresetDefinitions;
    if (!presetsForCategory.length) {
      this.selectedPresetId = null;
      return;
    }

    const hasSelectedPresetInCategory = this.selectedPresetId
      ? presetsForCategory.some(definition => definition.id === this.selectedPresetId)
      : false;

    if (!forceCategoryFallback && hasSelectedPresetInCategory) {
      return;
    }

    const preferredEnabledPreset = presetsForCategory.find(definition => !this.isPresetDisabled(definition));
    this.selectedPresetId = (preferredEnabledPreset || presetsForCategory[0]).id;
  }

  private buildDataGroups(): DataGroupInterface[] {
    const groups: DataGroupInterface[] = [
      {
        name: 'Common',
        data: [
          DataDuration.type,
          DataDistance.type,
          DataEnergy.type,
          DataAscent.type,
          DataDescent.type,
        ],
      },
      {
        name: 'Altitude',
        data: [
          DataAltitudeMax.type,
          DataAltitudeMin.type,
          DataAltitudeAvg.type,
          DataAscent.type,
          DataDescent.type,
        ],
      },
      {
        name: 'Heart Rate',
        data: [
          DataHeartRateMax.type,
          DataHeartRateMin.type,
          DataHeartRateAvg.type,
        ],
      },
      {
        name: 'Cadence',
        data: [
          DataCadenceMax.type,
          DataCadenceMin.type,
          DataCadenceAvg.type,
        ],
      },
      {
        name: 'Power',
        data: [
          DataPowerMax.type,
          DataPowerMin.type,
          DataPowerAvg.type,
        ],
      },
      {
        name: 'Temperature',
        data: [
          DataTemperatureMax.type,
          DataTemperatureMin.type,
          DataTemperatureAvg.type,
        ],
      },
      {
        name: 'Body',
        data: [
          DataFeeling.type,
          DataRPE.type,
          DataVO2Max.type,
          DataAerobicTrainingEffect.type,
          DataPeakEPOC.type,
        ],
      },
    ];

    try {
      const speedUnits: string[] = [];
      const unitSettings = this.data.user?.settings?.unitSettings;
      (unitSettings?.speedUnits || []).forEach(speedUnitKey => {
        const unit = SpeedUnitsToGradeAdjustedSpeedUnits[speedUnitKey];
        speedUnits.push(SpeedAvg['DataSpeedAvg' + unit].type);
        speedUnits.push(SpeedMin['DataSpeedMin' + unit].type);
        speedUnits.push(SpeedMax['DataSpeedMax' + unit].type);
      });
      if (speedUnits.length > 0) {
        groups.push({
          name: 'Speed',
          data: speedUnits,
        });
      }
    } catch {
      // Ignore invalid speed-unit conversion and keep baseline groups.
    }

    return groups;
  }

  private scrollAndFocusInitialEditSection(): void {
    if (!this.shouldAutoFocusEditSection || this.mode !== 'edit') {
      return;
    }

    this.shouldAutoFocusEditSection = false;
    if (this.category === 'curated') {
      const curatedSection = this.curatedSectionRef?.nativeElement;
      curatedSection?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      const firstEnabledCuratedOption = curatedSection?.querySelector('input[type="radio"]:not(:disabled)') as HTMLElement | null;
      firstEnabledCuratedOption?.focus?.();
      if (!firstEnabledCuratedOption) {
        this.focusSelect(this.editTileSelect);
      }
      return;
    }

    if (this.category === 'kpi') {
      const kpiSection = this.kpiSectionRef?.nativeElement;
      kpiSection?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      const firstEnabledKpiOption = kpiSection?.querySelector('input[type="radio"]:not(:disabled)') as HTMLElement | null;
      firstEnabledKpiOption?.focus?.();
      if (!firstEnabledKpiOption) {
        this.focusSelect(this.editTileSelect);
      }
      return;
    }

    if (this.category === 'map') {
      const mapSection = this.mapSectionRef?.nativeElement;
      mapSection?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      if (this.focusSelect(this.mapStyleSelect)) {
        return;
      }
      this.focusSelect(this.editTileSelect);
      return;
    }

    const customSection = this.customSectionRef?.nativeElement;
    customSection?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    if (this.focusSelect(this.customChartTypeSelect)) {
      return;
    }
    this.focusSelect(this.editTileSelect);
  }

  private focusSelect(select: MatSelect | undefined): boolean {
    if (!select) {
      return false;
    }
    const maybeFocusableSelect = select as unknown as { focus?: () => void };
    if (typeof maybeFocusableSelect.focus !== 'function') {
      return false;
    }
    maybeFocusableSelect.focus();
    return true;
  }

  private normalizeMapStyle(mapStyle: unknown): MapStyleName {
    const mapStyleCandidate = `${mapStyle || ''}`.trim().toLowerCase() as MapStyleName;
    if (this.mapStyleOptions.some(option => option.value === mapStyleCandidate)) {
      return mapStyleCandidate;
    }
    return AppUserUtilities.getDefaultDashboardMapStyle() as MapStyleName;
  }
}
