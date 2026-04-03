import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
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
  DASHBOARD_FORM_CHART_TYPE,
  DASHBOARD_RECOVERY_NOW_CHART_TYPE,
  type DashboardChartCategory,
  type DashboardCuratedChartType,
  getDashboardCuratedChartDefinitions,
  isDashboardCuratedChartType,
  isDashboardRecoveryNowChartType,
  resolveDashboardChartCategory,
} from '../../../helpers/dashboard-special-chart-types';
import { DASHBOARD_FORM_TRAINING_STRESS_SCORE_TYPE } from '../../../helpers/dashboard-form.helper';
import { AppUserUtilities } from '../../../utils/app.user.utilities';

export interface DashboardChartManagerDialogData {
  user: AppUserInterface;
}

export interface DashboardChartManagerDialogResult {
  saved: boolean;
}

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
  selector: 'app-dashboard-chart-manager-dialog',
  templateUrl: './chart-manager-dialog.component.html',
  styleUrls: ['./chart-manager-dialog.component.css'],
  standalone: false,
})
export class DashboardChartManagerDialogComponent implements OnInit {
  private static readonly excludedChartTypePatterns = [
    /^bri.*dev/i,
    /^spiral$/i,
  ];

  private static readonly maxDashboardTiles = 12;

  public readonly chartTypes = ChartTypes;
  public readonly chartCategoryTypes = ChartDataCategoryTypes;
  public readonly chartValueTypes = ChartDataValueTypes;
  public readonly customChartTypeOptions = Object.values(ChartTypes).filter(chartType =>
    !DashboardChartManagerDialogComponent.excludedChartTypePatterns.some(pattern => pattern.test(`${chartType}`))
  );
  public readonly curatedChartDefinitions = getDashboardCuratedChartDefinitions();
  public readonly modeOptions: IconOption<'add' | 'edit'>[] = [
    {
      value: 'add',
      label: 'Add chart',
      icon: 'add_circle',
      description: 'Create a new chart tile',
    },
    {
      value: 'edit',
      label: 'Edit chart',
      icon: 'edit',
      description: 'Update an existing chart tile',
    },
  ];
  public readonly categoryOptions: IconOption<DashboardChartCategory>[] = [
    {
      value: 'curated',
      label: 'Curated',
      icon: 'auto_awesome',
      description: 'Fixed behavior, independent from dashboard date range',
    },
    {
      value: 'custom',
      label: 'Custom',
      icon: 'tune',
      description: 'Configurable chart that reacts to dashboard filters',
    },
  ];
  public readonly curatedChartIconByType: Record<DashboardCuratedChartType, string> = {
    [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'health_and_safety',
    [DASHBOARD_FORM_CHART_TYPE]: 'insights',
  };
  public readonly curatedChartDescriptionByType: Record<DashboardCuratedChartType, string> = {
    [DASHBOARD_RECOVERY_NOW_CHART_TYPE]: 'Recovery left now vs elapsed recovery.',
    [DASHBOARD_FORM_CHART_TYPE]: 'Fitness/fatigue/form trend from derived training stress.',
  };
  public readonly timeIntervalOptions: Array<{ label: string; value: TimeIntervals }> = [
    { label: 'Auto', value: TimeIntervals.Auto },
    { label: 'Daily', value: TimeIntervals.Daily },
    { label: 'Weekly', value: TimeIntervals.Weekly },
    { label: 'Monthly', value: TimeIntervals.Monthly },
  ];

  public dataGroups: DataGroupInterface[] = [];

  public mode: 'add' | 'edit' = 'add';
  public category: DashboardChartCategory = 'custom';
  public editChartOrder: number | null = null;
  public curatedChartType: DashboardCuratedChartType = DASHBOARD_RECOVERY_NOW_CHART_TYPE;

  public customChartType: ChartTypes = AppUserUtilities.getDefaultUserDashboardChartTile().chartType;
  public customDataType = AppUserUtilities.getDefaultUserDashboardChartTile().dataType;
  public customDataValueType = AppUserUtilities.getDefaultUserDashboardChartTile().dataValueType;
  public customDataCategoryType = AppUserUtilities.getDefaultUserDashboardChartTile().dataCategoryType;
  public customTimeInterval = AppUserUtilities.getDefaultUserDashboardChartTile().dataTimeInterval;

  public isSaving = false;
  public saveError = '';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: DashboardChartManagerDialogData,
    private dialogRef: MatDialogRef<DashboardChartManagerDialogComponent, DashboardChartManagerDialogResult>,
    private userService: AppUserService,
  ) { }

  ngOnInit(): void {
    if (!this.data?.user) {
      throw new Error('Chart manager dialog requires a user.');
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

    if (this.chartTiles.length > 0) {
      this.editChartOrder = this.chartTiles[0].order;
    }
  }

  get chartTiles(): TileChartSettingsInterface[] {
    return [...(this.data?.user?.settings?.dashboardSettings?.tiles || [])]
      .filter(tile => tile.type === TileTypes.Chart)
      .map(tile => tile as TileChartSettingsInterface)
      .sort((left, right) => left.order - right.order);
  }

  get isTileLimitReached(): boolean {
    return (this.data?.user?.settings?.dashboardSettings?.tiles || []).length >= DashboardChartManagerDialogComponent.maxDashboardTiles;
  }

  get isSaveDisabled(): boolean {
    if (this.isSaving) {
      return true;
    }
    if (this.mode === 'add' && this.isTileLimitReached) {
      return true;
    }
    if (this.mode === 'edit' && this.editChartOrder === null) {
      return true;
    }
    if (this.category === 'curated' && this.isCuratedOptionDisabled(this.curatedChartType)) {
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
      return;
    }

    this.category = 'custom';
  }

  onEditChartSelectionChange(nextOrder: number): void {
    this.editChartOrder = Number(nextOrder);
    const editTarget = this.resolveEditTile();
    if (!editTarget) {
      return;
    }
    this.syncFormStateFromTile(editTarget);
  }

  onCategoryChange(nextCategory: DashboardChartCategory): void {
    this.category = nextCategory;
    this.saveError = '';

    if (nextCategory === 'curated') {
      const availableCurated = this.curatedChartDefinitions.find(def => !this.isCuratedOptionDisabled(def.chartType));
      if (availableCurated) {
        this.curatedChartType = availableCurated.chartType;
      }
    }
  }

  onCustomChartTypeChange(nextChartType: ChartTypes): void {
    this.customChartType = nextChartType;
    if (nextChartType === ChartTypes.Pie) {
      this.customDataValueType = ChartDataValueTypes.Total;
    }
  }

  isCuratedOptionDisabled(chartType: DashboardCuratedChartType): boolean {
    const editedOrder = this.mode === 'edit' ? this.editChartOrder : null;
    return this.chartTiles.some((tile) => (
      `${tile.chartType}` === `${chartType}`
      && (editedOrder === null || tile.order !== editedOrder)
    ));
  }

  getEditTileLabel(tile: TileChartSettingsInterface): string {
    const tileName = `${tile.name || ''}`.trim();
    const chartName = tileName || `${tile.chartType}`;
    return `${chartName} (#${tile.order + 1})`;
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
        const newTile = this.buildTileForMode(clonedTiles.length, { columns: 1, rows: 1 }, null);
        if (!newTile) {
          this.isSaving = false;
          return;
        }
        clonedTiles.push(newTile);
      } else {
        const editTile = this.resolveEditTile();
        if (!editTile) {
          this.saveError = 'Select a chart to edit.';
          this.isSaving = false;
          return;
        }

        const editIndex = clonedTiles.findIndex(tile => tile.order === editTile.order && tile.type === TileTypes.Chart);
        if (editIndex < 0) {
          this.saveError = 'Could not find the selected chart tile.';
          this.isSaving = false;
          return;
        }

        const replacement = this.buildTileForMode(editTile.order, editTile.size || { columns: 1, rows: 1 }, editTile);
        if (!replacement) {
          this.isSaving = false;
          return;
        }

        clonedTiles[editIndex] = replacement;
      }

      if (this.hasDuplicateCuratedTiles(clonedTiles)) {
        this.saveError = 'Curated charts can only be added once each.';
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
      this.saveError = 'Could not save chart settings.';
      console.error('[DashboardChartManagerDialogComponent] Failed to save chart settings', error);
    } finally {
      this.isSaving = false;
    }
  }

  private resolveEditTile(): TileChartSettingsInterface | null {
    if (this.editChartOrder === null) {
      return null;
    }
    return this.chartTiles.find(tile => tile.order === this.editChartOrder) || null;
  }

  private syncFormStateFromTile(tile: TileChartSettingsInterface): void {
    this.category = resolveDashboardChartCategory(tile.chartType) as DashboardChartCategory;

    if (isDashboardCuratedChartType(tile.chartType)) {
      this.curatedChartType = tile.chartType;
      return;
    }

    this.customChartType = tile.chartType;
    this.customDataType = tile.dataType;
    this.customDataValueType = tile.dataValueType;
    this.customDataCategoryType = tile.dataCategoryType;
    this.customTimeInterval = tile.dataTimeInterval || TimeIntervals.Auto;
  }

  private buildTileForMode(
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileChartSettingsInterface | null,
  ): TileChartSettingsInterface | null {
    if (this.category === 'curated') {
      if (this.isCuratedOptionDisabled(this.curatedChartType)) {
        this.saveError = 'This curated chart already exists.';
        return null;
      }
      return this.buildCuratedTile(this.curatedChartType, order, size);
    }

    return this.buildCustomTile(order, size, existingTile);
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

  private buildCustomTile(
    order: number,
    size: { columns: number; rows: number },
    existingTile: TileChartSettingsInterface | null,
  ): TileChartSettingsInterface {
    const isIntensityZones = this.customChartType === ChartTypes.IntensityZones;
    const isPie = this.customChartType === ChartTypes.Pie;
    const fallbackName = isIntensityZones ? 'Intensity Zones' : `${this.customDataType || 'Custom chart'}`;

    return {
      name: `${existingTile?.name || ''}`.trim() || fallbackName,
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

  private hasDuplicateCuratedTiles(tiles: TileSettingsInterface[]): boolean {
    const seen = new Set<string>();
    for (const tile of tiles) {
      if (tile.type !== TileTypes.Chart) {
        continue;
      }
      const chartTile = tile as TileChartSettingsInterface;
      if (!isDashboardCuratedChartType(chartTile.chartType)) {
        continue;
      }
      if (seen.has(`${chartTile.chartType}`)) {
        return true;
      }
      seen.add(`${chartTile.chartType}`);
    }
    return false;
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
}
