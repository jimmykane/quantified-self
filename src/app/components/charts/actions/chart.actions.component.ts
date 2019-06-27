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
import {ChartTypes} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import {UserService} from "../../../services/app.user.service";

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
  @Input() chartOrder: number;


  public chartTypes = ChartTypes;

  public dataGroups = [
    {
      name: 'Basic Data',
      data: [
        DataDuration.type,
        DataDistance.type,
        DataEnergy.type,
        DataAscent.type,
        DataDescent.type,
      ]
    },
    {
      name: 'Advanced Data',
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
