import {MatDialog} from '@angular/material/dialog';
import {User} from '@sports-alliance/sports-lib/lib/users/user';
import {Component, Input, OnInit} from '@angular/core';
import {DataDistance} from '@sports-alliance/sports-lib/lib/data/data.distance';
import {DataTotalTrainingEffect} from '@sports-alliance/sports-lib/lib/data/data.total-training-effect';
import {DataDuration} from '@sports-alliance/sports-lib/lib/data/data.duration';
import {DataEnergy} from '@sports-alliance/sports-lib/lib/data/data.energy';
import {DataAscent} from '@sports-alliance/sports-lib/lib/data/data.ascent';
import {DataDescent} from '@sports-alliance/sports-lib/lib/data/data.descent';
import {DataHeartRateAvg} from '@sports-alliance/sports-lib/lib/data/data.heart-rate-avg';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes, TileChartSettingsInterface, TileTypes, TimeIntervals,
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import {AppUserService} from '../../../../services/app.user.service';
import {DataAltitudeMax} from '@sports-alliance/sports-lib/lib/data/data.altitude-max';
import {DataAltitudeMin} from '@sports-alliance/sports-lib/lib/data/data.altitude-min';
import {DataAltitudeAvg} from '@sports-alliance/sports-lib/lib/data/data.altitude-avg';
import {DataHeartRateMax} from '@sports-alliance/sports-lib/lib/data/data.heart-rate-max';
import {DataHeartRateMin} from '@sports-alliance/sports-lib/lib/data/data.heart-rate-min';
import {DataPowerMax} from '@sports-alliance/sports-lib/lib/data/data.power-max';
import {DataPowerMin} from '@sports-alliance/sports-lib/lib/data/data.power-min';
import {DataPowerAvg} from '@sports-alliance/sports-lib/lib/data/data.power-avg';
import {DataTemperatureMax} from '@sports-alliance/sports-lib/lib/data/data.temperature-max';
import {DataTemperatureAvg} from '@sports-alliance/sports-lib/lib/data/data.temperature-avg';
import {DataTemperatureMin} from '@sports-alliance/sports-lib/lib/data/data.temperature-min';
import {DataCadenceMax} from '@sports-alliance/sports-lib/lib/data/data.cadence-max';
import {DataCadenceAvg} from '@sports-alliance/sports-lib/lib/data/data.cadence-avg';
import {DataCadenceMin} from '@sports-alliance/sports-lib/lib/data/data.cadence-min';
import {DataVO2Max} from '@sports-alliance/sports-lib/lib/data/data.vo2-max';
import {DataPeakEPOC} from '@sports-alliance/sports-lib/lib/data/data.peak-epoc';
import {DataFeeling} from '@sports-alliance/sports-lib/lib/data/data.feeling';
import {DataRPE} from '@sports-alliance/sports-lib/lib/data/data.rpe';
import {AngularFireAnalytics} from '@angular/fire/analytics';
import { TileActionsAbstract } from '../tile.actions.abstract';
import { DataRecoveryTime } from '@sports-alliance/sports-lib/lib/data/data.recovery-time';
import { EnumeratorHelpers } from '../../../../helpers/enumerator-helpers';


@Component({
  selector: 'app-tile-chart-actions',
  templateUrl: './tile.chart.actions.component.html',
  styleUrls: ['../tile.actions.abstract.css', './tile.chart.actions.component.css'],
  providers: [],
})
export class TileChartActionsComponent extends TileActionsAbstract implements OnInit {
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

  constructor(
    userService: AppUserService,
    afa: AngularFireAnalytics) {
    super(userService, afa);
  }

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

  async changeChartTimeInterval(event) {
    this.afa.logEvent('dashboard_tile_action', {method: 'changeChartTimeInterval'});
    (<TileChartSettingsInterface>this.user.settings.dashboardSettings.tiles.find(tile => tile.order === this.order)).dataTimeInterval = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }


}
