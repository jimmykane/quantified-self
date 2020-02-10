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
  ChartTypes,
  UserDashboardChartSettingsInterface
} from '@sports-alliance/sports-lib/lib/users/user.dashboard.chart.settings.interface';
import {UserService} from '../../../services/app.user.service';
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
import * as firebase from 'firebase/app';
import {DataFeeling} from '@sports-alliance/sports-lib/lib/data/data.feeling';
import {DataRPE} from '@sports-alliance/sports-lib/lib/data/data.rpe';
import {AngularFireAnalytics} from '@angular/fire/analytics';
import {DataRecoveryTime} from '@sports-alliance/sports-lib/lib/data/dataRecoveryTime';

@Component({
  selector: 'app-chart-actions',
  templateUrl: './chart.actions.component.html',
  styleUrls: ['./chart.actions.component.css'],
  providers: [],
})
export class ChartActionsComponent implements OnInit {
  @Input() user: User;
  @Input() chartType: ChartTypes;
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes; // @todo take in use
  @Input() chartOrder: number;
  @Input() filterLowValues: boolean;


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
    this.afa.logEvent('dashboard_chart_action', {method: 'changeChartType'});
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).type = event.value;
    // If its pie show only totals
    if (event.value === ChartTypes.Pie) {
      this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).dataValueType = ChartDataValueTypes.Total;
    }
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeChartDataType(event) {
    this.afa.logEvent('dashboard_chart_action', {method: 'changeChartDataType'});
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).dataType = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeChartDataValueType(event) {
    this.afa.logEvent('dashboard_chart_action', {method: 'changeChartDataValueType'});
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).dataValueType = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async changeChartDataCategoryType(event) {
    this.afa.logEvent('dashboard_chart_action', {method: 'changeChartDataCategoryType'});
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).dataCategoryType = event.value;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async addNewChart($event: MouseEvent) {
    this.afa.logEvent('dashboard_chart_action', {method: 'addNewChart'});
    const chart = Object.assign({}, this.user.settings.dashboardSettings.chartsSettings.find((chartSetting: UserDashboardChartSettingsInterface) => chartSetting.order === this.chartOrder));
    chart.order = this.user.settings.dashboardSettings.chartsSettings.length;
    this.user.settings.dashboardSettings.chartsSettings.push(chart);
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async switchFilterLowValues(event){
    this.afa.logEvent('dashboard_chart_action', {method: 'switchFilterLowValues'});
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).filterLowValues = this.filterLowValues;
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  async deleteChart(event) {
    this.afa.logEvent('dashboard_chart_action', {method: 'deleteChart'});
    if (this.user.settings.dashboardSettings.chartsSettings.length === 1) {
      throw new Error('Cannot delete chart there is only one left');
    }
    // should search and replace order index according to the remaining order indexes after the splice
    this.user.settings.dashboardSettings.chartsSettings = this.user.settings.dashboardSettings.chartsSettings
      .filter((chartSetting) => chartSetting.order !== this.chartOrder)
      .map((chartSetting, index) => {
        chartSetting.order = index;
        return chartSetting
      });
    return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  constructor(
    private userService: UserService,
    private afa: AngularFireAnalytics,
    public dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }


}
