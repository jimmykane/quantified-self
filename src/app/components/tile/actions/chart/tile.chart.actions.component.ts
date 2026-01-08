import { Component, Input, OnInit } from '@angular/core';
import { DataDistance } from '@sports-alliance/sports-lib';
import { DataAerobicTrainingEffect } from '@sports-alliance/sports-lib';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DataEnergy } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  TileChartSettingsInterface,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { AppUserService } from '../../../../services/app.user.service';
import { DataAltitudeMax } from '@sports-alliance/sports-lib';
import { DataAltitudeMin } from '@sports-alliance/sports-lib';
import { DataAltitudeAvg } from '@sports-alliance/sports-lib';
import { DataHeartRateMax } from '@sports-alliance/sports-lib';
import { DataHeartRateMin } from '@sports-alliance/sports-lib';
import { DataPowerMax } from '@sports-alliance/sports-lib';
import { DataPowerMin } from '@sports-alliance/sports-lib';
import { DataPowerAvg } from '@sports-alliance/sports-lib';
import { DataTemperatureMax } from '@sports-alliance/sports-lib';
import { DataTemperatureAvg } from '@sports-alliance/sports-lib';
import { DataTemperatureMin } from '@sports-alliance/sports-lib';
import { DataCadenceMax } from '@sports-alliance/sports-lib';
import { DataCadenceAvg } from '@sports-alliance/sports-lib';
import { DataCadenceMin } from '@sports-alliance/sports-lib';
import * as SpeedMax from '@sports-alliance/sports-lib';
import * as SpeedAvg from '@sports-alliance/sports-lib';
import * as SpeedMin from '@sports-alliance/sports-lib';
import { DataVO2Max } from '@sports-alliance/sports-lib';
import { DataPeakEPOC } from '@sports-alliance/sports-lib';
import { DataFeeling } from '@sports-alliance/sports-lib';
import { DataRPE } from '@sports-alliance/sports-lib';
import { TileActionsAbstractDirective } from '../tile-actions-abstract.directive';
import { DataRecoveryTime } from '@sports-alliance/sports-lib';
import { SpeedUnitsToGradeAdjustedSpeedUnits } from '@sports-alliance/sports-lib';


@Component({
  selector: 'app-tile-chart-actions',
  templateUrl: './tile.chart.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.chart.actions.component.css'],
  providers: [],
  standalone: false
})
export class TileChartActionsComponent extends TileActionsAbstractDirective implements OnInit {
  @Input() chartType: ChartTypes;
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes;
  @Input() chartTimeInterval: TimeIntervals;
  @Input() chartOrder: number;

  public chartTypes = ChartTypes;
  public chartValueTypes = ChartDataValueTypes;
  public chartCategoryTypes = ChartDataCategoryTypes;

  public dataGroups = [
    {
      name: 'Common',
      data: [
        DataDuration.type,
        DataDistance.type,
        DataEnergy.type,
        DataAscent.type,
        DataDescent.type
      ]
    },
    {
      name: 'Altitude',
      data: [
        DataAltitudeMax.type,
        DataAltitudeMin.type,
        DataAltitudeAvg.type,
        DataAscent.type,
        DataDescent.type
      ]
    },
    {
      name: 'Heart Rate',
      data: [
        DataHeartRateMax.type,
        DataHeartRateMin.type,
        DataHeartRateAvg.type
      ]
    },
    {
      name: 'Cadence',
      data: [
        DataCadenceMax.type,
        DataCadenceMin.type,
        DataCadenceAvg.type
      ]
    },
    {
      name: 'Power',
      data: [
        DataPowerMax.type,
        DataPowerMin.type,
        DataPowerAvg.type
      ]
    },
    {
      name: 'Temperature',
      data: [
        DataTemperatureMax.type,
        DataTemperatureMin.type,
        DataTemperatureAvg.type
      ]
    },
    {
      name: 'Body',
      data: [
        DataFeeling.type,
        DataRPE.type,
        DataVO2Max.type,
        DataAerobicTrainingEffect.type,
        DataPeakEPOC.type,
        DataRecoveryTime.type
      ]
    }
  ];

  constructor(
    userService: AppUserService) {
    super(userService);
  }

  async changeChartType(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeChartType' });
    const chart = (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order));
    chart.chartType = event.value;
    // If its pie show only totals
    if (event.value === ChartTypes.Pie) {
      chart.dataValueType = ChartDataValueTypes.Total;
    }
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  async changeChartDataType(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeChartDataType' });
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataType = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  async changeChartDataValueType(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeChartDataValueType' });
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataValueType = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  async changeChartDataCategoryType(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeChartDataCategoryType' });
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataCategoryType = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  async changeChartTimeInterval(event) {
    this.analyticsService.logEvent('dashboard_tile_action', { method: 'changeChartTimeInterval' });
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataTimeInterval = event.value;
    return this.userService.updateUserProperties(this.user, { settings: this.user.settings });
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }

    // See https://sentry.io/organizations/dimitrios-kanellopoulos/issues/2051985404/?project=1194244&referrer=slack
    try {
      const speedUnits = [];
      this.user.settings.unitSettings.speedUnits.forEach(key => {
        const unit = SpeedUnitsToGradeAdjustedSpeedUnits[key];
        speedUnits.push(SpeedAvg['DataSpeedAvg' + unit].type);
        speedUnits.push(SpeedMin['DataSpeedMin' + unit].type);
        speedUnits.push(SpeedMax['DataSpeedMax' + unit].type);
      });
      this.dataGroups.push({
        name: 'Speed',
        data: speedUnits
      });
    } catch (e) {
      // Noop
    }
  }
}

export enum ChartTypes {
  Pie = 'Pie',
  ColumnsHorizontal = 'Columns Horizontal',
  ColumnsVertical = 'Columns Vertical',
  PyramidsVertical = 'Pyramids Vertical',
  LinesHorizontal = 'Lines Horizontal',
  LinesVertical = 'Lines Vertical',
  Spiral = 'Spiral',
  IntensityZones = 'Intensity Zones',

}
