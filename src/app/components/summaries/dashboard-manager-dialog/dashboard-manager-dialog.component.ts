import { AfterViewInit, Component, ElementRef, Inject, OnInit, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
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
  DataRecoveryTime,
  DataTemperatureAvg,
  DataTemperatureMax,
  DataTemperatureMin,
  DataVO2Max,
  SpeedUnitsToGradeAdjustedSpeedUnits,
  TileChartSettingsInterface,
  TileMapSettingsInterface,
  TileSettingsInterface,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';
import * as SpeedAvg from '@sports-alliance/sports-lib';
import * as SpeedMin from '@sports-alliance/sports-lib';
import * as SpeedMax from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../services/app.user.service';
import { AppUserInterface } from '../../../models/app-user.interface';
import {
  DASHBOARD_ACWR_KPI_CHART_TYPE,
  DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE,
  DASHBOARD_EFFICIENCY_TREND_CHART_TYPE,
  DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE,
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_FORM_NOW_KPI_CHART_TYPE,
  DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE,
  DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE,
  DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE,
  DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE,
  DASHBOARD_RAMP_RATE_KPI_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  type DashboardCuratedChartType,
  type DashboardKpiGroup,
  getDashboardCuratedChartDefinitions,
  type DashboardKpiChartType,
  getDashboardKpiChartDefinitions,
  isDashboardKpiChartType,
  isDashboardCuratedChartType,
  isDashboardRecoveryNowChartType,
  isDashboardSpecialChartType,
  resolveDashboardChartCategory,
} from '../../../helpers/dashboard-special-chart-types';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from '../../../helpers/dashboard-form.helper';
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

export interface DashboardManagerDialogData {
  user: AppUserInterface;
  initialMode?: 'add' | 'edit';
  initialEditTileOrder?: number | null;
}

export interface DashboardManagerDialogResult {
  saved: boolean;
}

type DashboardManagerCategory = DashboardManagerPresetCategory;
type DashboardMapTileSettings = TileMapSettingsInterface & { mapStyle?: MapStyleName };
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

@Component({
  selector: 'app-dashboard-manager-dialog',
  templateUrl: './dashboard-manager-dialog.component.html',
  styleUrls: ['./dashboard-manager-dialog.component.css'],
  standalone: false,
})
export class DashboardManagerDialogComponent implements OnInit, AfterViewInit {
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
      description: 'Compact derived KPI cards',
    },
    {
      value: 'custom',
      label: 'Custom',
      icon: 'tune',
      description: 'Configurable chart that reacts to dashboard filters',
    },
    {
      value: 'map',
      label: 'Map',
      icon: 'map',
      description: 'Dashboard map tile that reacts to dashboard filters',
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
  };
  public readonly curatedChartDescriptionByType: Record<DashboardCuratedChartType, string> = {
    [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'Recovery left now vs elapsed recovery.',
    [DASHBOARD_FORM_CHART_TYPE]: 'Fitness/fatigue/form trend from derived training stress.',
    [DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE]: '7-day projected freshness from current CTL/ATL decay.',
    [DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE]: 'Weekly easy/moderate/hard intensity split (Power or HR fallback).',
    [DASHBOARD_EFFICIENCY_TREND_CHART_TYPE]: 'Weekly duration-weighted power/heart-rate efficiency trend.',
  };
  public readonly kpiChartIconByType: Record<DashboardKpiChartType, string> = {
    [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'monitoring',
    [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'speed',
    [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'stacked_line_chart',
    [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'self_improvement',
    [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'trending_up',
    [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'wb_sunny',
    [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'flash_on',
    [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'query_stats',
  };
  public readonly kpiChartDescriptionByType: Record<DashboardKpiChartType, string> = {
    [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'Acute/chronic workload ratio with 8-week sparkline.',
    [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'CTL delta over 7 days with 8-week sparkline.',
    [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'Weekly strain KPI with monotony context and sparkline.',
    [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'Prior-day TSB readiness from derived load state.',
    [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'Prior-day TSB projection at +7d with zero load.',
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

  public mapStyle: MapStyleName = this.normalizeMapStyle(AppUserUtilities.getDefaultDashboardMapStyle());
  public mapClusterMarkers = true;
  public presetCategory: DashboardManagerPresetCategory = 'curated';
  public selectedPresetId: DashboardManagerPresetId | null = DASHBOARD_MANAGER_PRESET_IDS.CURATED_RECOVERY;

  public isSaving = false;
  public saveError = '';

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
    private userService: AppUserService,
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

  onModeChange(nextMode: 'add' | 'edit'): void {
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
    this.ensurePresetSelection();
  }

  onWorkflowTabChange(nextIndex: number): void {
    this.activeWorkflowTab = nextIndex === 1 ? 'presets' : 'manual';
    this.saveError = '';
    this.ensurePresetSelection();
  }

  onEditTileSelectionChange(nextOrder: number): void {
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

    if (nextCategory === 'map') {
      const editTile = this.resolveEditTile();
      if (editTile?.type === TileTypes.Map) {
        this.syncFormStateFromTile(editTile);
      }
    }
  }

  onPresetCategoryChange(nextCategory: DashboardManagerPresetCategory): void {
    this.presetCategory = nextCategory;
    this.saveError = '';
    this.ensurePresetSelection(true);
  }

  onKpiGroupChange(nextGroup: DashboardKpiGroup): void {
    this.kpiGroup = nextGroup;
    this.saveError = '';
    const nextAvailable = this.filteredKpiChartDefinitions.find(def => !this.isKpiOptionDisabled(def.chartType));
    if (nextAvailable) {
      this.kpiChartType = nextAvailable.chartType;
    }
  }

  onPresetKpiGroupChange(nextGroup: DashboardKpiGroup): void {
    this.presetKpiGroup = nextGroup;
    this.saveError = '';
    this.ensurePresetSelection(true);
  }

  onPresetSelectionChange(nextPresetId: DashboardManagerPresetId): void {
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
    this.customChartType = nextChartType;
    if (nextChartType === ChartTypes.Pie) {
      this.customDataValueType = ChartDataValueTypes.Total;
    }
  }

  isCuratedOptionDisabled(chartType: DashboardCuratedChartType): boolean {
    const editedOrder = this.mode === 'edit' ? this.editTileOrder : null;
    return this.chartTiles.some((tile) => (
      `${tile.chartType}` === `${chartType}`
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
    this.dialogRef.close({ saved: false });
  }

  async save(): Promise<void> {
    if (this.isSaveDisabled) {
      return;
    }

    this.isSaving = true;
    this.saveError = '';
    const dashboardSettings = this.data.user.settings.dashboardSettings;
    const previousTiles = (dashboardSettings.tiles || []).map((tile: TileSettingsInterface) => ({
      ...tile,
      size: tile.size ? { ...tile.size } : tile.size,
    }));
    const previousDismissedRecoveryTile = dashboardSettings.dismissedCuratedRecoveryNowTile;

    try {
      const clonedTiles = (dashboardSettings.tiles || []).map((tile: TileSettingsInterface) => ({
        ...tile,
        size: tile.size ? { ...tile.size } : tile.size,
      }));

      if (this.mode === 'add') {
        const defaultSizeForAdd = this.resolveDefaultAddTileSize();
        const newTile = this.activeWorkflowTab === 'presets'
          ? this.buildPresetTileForMode(clonedTiles.length, defaultSizeForAdd)
          : this.buildTileForMode(clonedTiles.length, defaultSizeForAdd, null);
        if (!newTile) {
          this.isSaving = false;
          return;
        }
        clonedTiles.push(newTile);
      } else {
        const editTile = this.resolveEditTile();
        if (!editTile) {
          this.saveError = 'Select a tile to edit.';
          this.isSaving = false;
          return;
        }

        const editIndex = clonedTiles.findIndex(tile => tile.order === editTile.order);
        if (editIndex < 0) {
          this.saveError = 'Could not find the selected tile.';
          this.isSaving = false;
          return;
        }

        const replacement = this.activeWorkflowTab === 'presets'
          ? this.buildPresetTileForMode(editTile.order, editTile.size || { columns: 1, rows: 1 })
          : this.buildTileForMode(editTile.order, editTile.size || { columns: 1, rows: 1 }, editTile);
        if (!replacement) {
          this.isSaving = false;
          return;
        }

        clonedTiles[editIndex] = replacement;
      }

      if (this.hasDuplicateSpecialTiles(clonedTiles)) {
        this.saveError = 'Derived curated and KPI chart types can only be added once each.';
        this.isSaving = false;
        return;
      }

      if (this.hasDuplicateMapTiles(clonedTiles)) {
        this.saveError = 'Map tile can only be added once.';
        this.isSaving = false;
        return;
      }

      dashboardSettings.tiles = clonedTiles;
      if (dashboardSettings.tiles.some(tile => tile.type === TileTypes.Chart && isDashboardRecoveryNowChartType((tile as TileChartSettingsInterface).chartType))) {
        dashboardSettings.dismissedCuratedRecoveryNowTile = false;
      }

      await this.userService.updateUserProperties(this.data.user, { settings: this.data.user.settings });
      this.dialogRef.close({ saved: true });
    } catch (error) {
      dashboardSettings.tiles = previousTiles.map((tile: TileSettingsInterface) => ({
        ...tile,
        size: tile.size ? { ...tile.size } : tile.size,
      }));
      dashboardSettings.dismissedCuratedRecoveryNowTile = previousDismissedRecoveryTile;
      this.saveError = 'Could not save dashboard tile settings.';
      console.error('[DashboardManagerDialogComponent] Failed to save dashboard tile settings', error);
    } finally {
      this.isSaving = false;
    }
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
      return this.buildCuratedTile(this.curatedChartType, order, size);
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

    return buildDashboardManagerPresetTile({
      presetId: selectedPreset.id,
      order,
      size,
    });
  }

  private buildCuratedTile(
    chartType: DashboardCuratedChartType,
    order: number,
    size: { columns: number; rows: number },
  ): TileChartSettingsInterface {
    if (chartType === DASHBOARD_FORM_CHART_TYPE) {
      return {
        name: 'Form',
        type: TileTypes.Chart,
        order,
        size,
        chartType: DASHBOARD_FORM_CHART_TYPE as unknown as ChartTypes,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Daily,
      };
    }

    if (chartType === DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE) {
      return {
        name: 'Freshness Forecast',
        type: TileTypes.Chart,
        order,
        size,
        chartType: DASHBOARD_FRESHNESS_FORECAST_CHART_TYPE as unknown as ChartTypes,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
      };
    }

    if (chartType === DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE) {
      return {
        name: 'Intensity Distribution',
        type: TileTypes.Chart,
        order,
        size,
        chartType: DASHBOARD_INTENSITY_DISTRIBUTION_CHART_TYPE as unknown as ChartTypes,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
      };
    }

    if (chartType === DASHBOARD_EFFICIENCY_TREND_CHART_TYPE) {
      return {
        name: 'Efficiency Trend',
        type: TileTypes.Chart,
        order,
        size,
        chartType: DASHBOARD_EFFICIENCY_TREND_CHART_TYPE as unknown as ChartTypes,
        dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
        dataValueType: ChartDataValueTypes.Total,
        dataCategoryType: ChartDataCategoryTypes.DateType,
        dataTimeInterval: TimeIntervals.Weekly,
      };
    }

    return {
      name: 'Recovery',
      type: TileTypes.Chart,
      order,
      size,
      chartType: DASHBOARD_RECOVERY_NOW_CHART_TYPE as unknown as ChartTypes,
      dataType: DataRecoveryTime.type,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Auto,
    };
  }

  private buildKpiTile(
    chartType: DashboardKpiChartType,
    order: number,
    size: { columns: number; rows: number },
  ): TileChartSettingsInterface {
    const chartNameByType: Record<DashboardKpiChartType, string> = {
      [DASHBOARD_ACWR_KPI_CHART_TYPE]: 'ACWR',
      [DASHBOARD_RAMP_RATE_KPI_CHART_TYPE]: 'Ramp Rate',
      [DASHBOARD_MONOTONY_STRAIN_KPI_CHART_TYPE]: 'Monotony / Strain',
      [DASHBOARD_FORM_NOW_KPI_CHART_TYPE]: 'Form Now',
      [DASHBOARD_FORM_PLUS_7D_KPI_CHART_TYPE]: 'Form +7d',
      [DASHBOARD_EASY_PERCENT_KPI_CHART_TYPE]: 'Easy %',
      [DASHBOARD_HARD_PERCENT_KPI_CHART_TYPE]: 'Hard %',
      [DASHBOARD_EFFICIENCY_DELTA_4W_KPI_CHART_TYPE]: 'Efficiency Δ (4w)',
    };
    const chartName = chartNameByType[chartType];
    return {
      name: chartName,
      type: TileTypes.Chart,
      order,
      size,
      chartType: chartType as unknown as ChartTypes,
      dataType: DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE,
      dataValueType: ChartDataValueTypes.Total,
      dataCategoryType: ChartDataCategoryTypes.DateType,
      dataTimeInterval: TimeIntervals.Weekly,
    };
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
    };
  }

  private buildCustomTile(
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileSettingsInterface | null,
  ): TileChartSettingsInterface {
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
    };
  }

  private hasDuplicateSpecialTiles(tiles: TileSettingsInterface[]): boolean {
    const seen = new Set<string>();
    for (const tile of tiles) {
      if (tile.type !== TileTypes.Chart) {
        continue;
      }
      const chartTile = tile as TileChartSettingsInterface;
      if (!isDashboardSpecialChartType(chartTile.chartType)) {
        continue;
      }
      if (seen.has(`${chartTile.chartType}`)) {
        return true;
      }
      seen.add(`${chartTile.chartType}`);
    }
    return false;
  }

  private resolveDefaultAddTileSize(): { columns: number; rows: number } {
    if (this.activeWorkflowTab === 'presets') {
      const selectedPreset = this.selectedPresetDefinition;
      if (selectedPreset?.category === 'curated') {
        return { columns: 2, rows: 1 };
      }
      return { columns: 1, rows: 1 };
    }

    if (this.category === 'curated') {
      return { columns: 2, rows: 1 };
    }

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
    } catch (_error) {
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
