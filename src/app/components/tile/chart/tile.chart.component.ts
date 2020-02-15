import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import { MapThemes, MapTypes } from '@sports-alliance/sports-lib/lib/users/settings/user.map.settings.interface';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TileChartSettingsInterface
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { TileAbstract } from '../tile.abstract';
import { ChartThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';
import { SummariesChartDataDateRages } from '../../summaries/summaries.component';
import { DataDuration } from '@sports-alliance/sports-lib/lib/data/data.duration';
import { DataDistance } from '@sports-alliance/sports-lib/lib/data/data.distance';
import { DataEnergy } from '@sports-alliance/sports-lib/lib/data/data.energy';
import { DataAscent } from '@sports-alliance/sports-lib/lib/data/data.ascent';
import { DataDescent } from '@sports-alliance/sports-lib/lib/data/data.descent';
import { DataAltitudeMax } from '@sports-alliance/sports-lib/lib/data/data.altitude-max';
import { DataAltitudeMin } from '@sports-alliance/sports-lib/lib/data/data.altitude-min';
import { DataAltitudeAvg } from '@sports-alliance/sports-lib/lib/data/data.altitude-avg';
import { DataHeartRateMax } from '@sports-alliance/sports-lib/lib/data/data.heart-rate-max';
import { DataHeartRateMin } from '@sports-alliance/sports-lib/lib/data/data.heart-rate-min';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib/lib/data/data.heart-rate-avg';
import { DataCadenceMax } from '@sports-alliance/sports-lib/lib/data/data.cadence-max';
import { DataCadenceMin } from '@sports-alliance/sports-lib/lib/data/data.cadence-min';
import { DataCadenceAvg } from '@sports-alliance/sports-lib/lib/data/data.cadence-avg';
import { DataPowerMax } from '@sports-alliance/sports-lib/lib/data/data.power-max';
import { DataPowerMin } from '@sports-alliance/sports-lib/lib/data/data.power-min';
import { DataPowerAvg } from '@sports-alliance/sports-lib/lib/data/data.power-avg';
import { DataTemperatureMax } from '@sports-alliance/sports-lib/lib/data/data.temperature-max';
import { DataTemperatureMin } from '@sports-alliance/sports-lib/lib/data/data.temperature-min';
import { DataTemperatureAvg } from '@sports-alliance/sports-lib/lib/data/data.temperature-avg';
import { DataFeeling } from '@sports-alliance/sports-lib/lib/data/data.feeling';
import { DataRPE } from '@sports-alliance/sports-lib/lib/data/data.rpe';
import { DataVO2Max } from '@sports-alliance/sports-lib/lib/data/data.vo2-max';
import { DataTotalTrainingEffect } from '@sports-alliance/sports-lib/lib/data/data.total-training-effect';
import { DataPeakEPOC } from '@sports-alliance/sports-lib/lib/data/data.peak-epoc';
import { DataRecoveryTime } from '@sports-alliance/sports-lib/lib/data/dataRecoveryTime';

@Component({
  selector: 'app-tile-chart',
  templateUrl: './tile.chart.component.html',
  styleUrls: ['../tile.abstract.css', './tile.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class TileChartComponent extends TileAbstract {
  @Input() chartType: ChartTypes;
  @Input() dataType: string;
  @Input() dataValueType: ChartDataValueTypes;
  @Input() dataCategoryType: ChartDataCategoryTypes;
  @Input() chartTheme: ChartThemes;
  @Input() filterLowValues: boolean;
  @Input() dataDateRange: SummariesChartDataDateRages;
  @Input() data: any;

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
        DataDescent.type,
      ]
    },
    {
      name: 'Altitude',
      data: [
        DataAltitudeMax.type,
        DataAltitudeMin.type,
        DataAltitudeAvg.type,
        DataAscent.type,
        DataDescent.type,
      ]
    },
    {
      name: 'Heart Rate',
      data: [
        DataHeartRateMax.type,
        DataHeartRateMin.type,
        DataHeartRateAvg.type,
      ]
    },
    {
      name: 'Cadence',
      data: [
        DataCadenceMax.type,
        DataCadenceMin.type,
        DataCadenceAvg.type,
      ]
    },
    {
      name: 'Power',
      data: [
        DataPowerMax.type,
        DataPowerMin.type,
        DataPowerAvg.type,
      ]
    },
    {
      name: 'Temperature',
      data: [
        DataTemperatureMax.type,
        DataTemperatureMin.type,
        DataTemperatureAvg.type,
      ]
    },
    {
      name: 'Body',
      data: [
        DataFeeling.type,
        DataRPE.type,
        DataVO2Max.type,
        DataTotalTrainingEffect.type,
        DataPeakEPOC.type,
        DataRecoveryTime.type,
      ]
    },
  ];


  async changeChartType(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeChartType'});
    const chart = (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order));
    chart.chartType = event.value;
    // If its pie show only totals
    if (event.value === ChartTypes.Pie) {
      chart.dataValueType = ChartDataValueTypes.Total;
    }
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeChartDataType(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeChartDataType'});
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataType = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeChartDataValueType(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeChartDataValueType'});
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataValueType = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeChartDataCategoryType(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeChartDataCategoryType'});
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataCategoryType = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async switchFilterLowValues(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'switchFilterLowValues'});
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).filterLowValues = this.filterLowValues;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }
}
