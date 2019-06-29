import {MatDialog} from '@angular/material/dialog';
import {User} from 'quantified-self-lib/lib/users/user';
import {Component, Input, OnInit} from '@angular/core';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataTotalTrainingEffect} from 'quantified-self-lib/lib/data/data.total-training-effect';
import {DataDuration} from 'quantified-self-lib/lib/data/data.duration';
import {DataEnergy} from 'quantified-self-lib/lib/data/data.energy';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import {DataRecovery} from 'quantified-self-lib/lib/data/data.recovery';
import {DataHeartRateAvg} from 'quantified-self-lib/lib/data/data.heart-rate-avg';
import {DataEPOC} from 'quantified-self-lib/lib/data/data.epoc';
import {DataPeakTrainingEffect} from 'quantified-self-lib/lib/data/data.peak-training-effect';
import {ChartTypes, ChartDataValueTypes} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import {UserService} from '../../../services/app.user.service';
import {DataAltitudeMax} from 'quantified-self-lib/lib/data/data.altitude-max';
import {DataAltitudeMin} from 'quantified-self-lib/lib/data/data.altitude-min';
import {DataAltitudeAvg} from 'quantified-self-lib/lib/data/data.altitude-avg';
import {DataAscentTime} from 'quantified-self-lib/lib/data/data.ascent-time';
import {DataDescentTime} from 'quantified-self-lib/lib/data/data.descent-time';
import {DataHeartRateMax} from "quantified-self-lib/lib/data/data.heart-rate-max";
import {DataHeartRateMin} from "quantified-self-lib/lib/data/data.heart-rate-min";
import {DataPowerMax} from "quantified-self-lib/lib/data/data.power-max";
import {DataPowerMin} from "quantified-self-lib/lib/data/data.power-min";
import {DataPowerAvg} from "quantified-self-lib/lib/data/data.power-avg";
import {DataTemperatureMax} from "quantified-self-lib/lib/data/data.temperature-max";
import {DataTemperatureAvg} from "quantified-self-lib/lib/data/data.temperature-avg";
import {DataTemperatureMin} from "quantified-self-lib/lib/data/data.temperature-min";

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
  @Input() chartOrder: number;


  public chartTypes = ChartTypes;
  public chartValueTypes = ChartDataValueTypes;

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
        DataAscentTime.type,
        DataDescent.type,
        DataDescentTime.type,
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
        DataRecovery.type,
        DataTotalTrainingEffect.type,
        DataEPOC.type,
        DataPeakTrainingEffect.type
      ]
    },
  ];

  changeChartType(event) {
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).type = event.value;
    this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  changeChartDataType(event) {
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).dataType = event.value;
    this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  changeChartDataValueType(event) {
    this.user.settings.dashboardSettings.chartsSettings.find(chartSetting => chartSetting.order === this.chartOrder).dataValueType = event.value;
    this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  constructor(
    private userService: UserService,
    public dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('Component needs user');
    }
  }
}
