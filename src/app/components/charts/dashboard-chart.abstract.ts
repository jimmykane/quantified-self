import {ChartAbstract} from './chart.abstract';
import {Input, OnChanges} from '@angular/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {SummariesChartDataDateRages, SummariesChartDataInterface} from '../summaries/summaries.component';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes
} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';


export abstract class DashboardChartAbstract extends ChartAbstract implements OnChanges {
  @Input() data: any;


  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes;
  @Input() filterLowValues: boolean;
  @Input() chartDataDateRange?: SummariesChartDataDateRages;

  ngOnChanges(simpleChanges) {
    // If theme changes destroy the chart
    if (simpleChanges.chartTheme) {
      this.destroyChart();
    }

    if (!this.data) {
      this.loading();
      return;
    }

    this.loaded();
    if (!this.data.length) {
      return;
    }

    // 1. If there is no chart create
    if (!this.chart) {
      this.chart = <am4charts.XYChart>this.createChart();
      this.chart.data = [];
    }


    if (!simpleChanges.data && !simpleChanges.chartTheme) {
      return;
    }

    // To create an animation here it has to update the values of the data items
    this.chart.data = this.generateChartData(this.data);
  }

  protected getCategoryAxis(chartDataCategoryType: ChartDataCategoryTypes, chartDateDateRange: SummariesChartDataDateRages): am4charts.CategoryAxis | am4charts.DateAxis | am4charts.Axis {
    switch (chartDataCategoryType) {
      case ChartDataCategoryTypes.DateType:
        const axis = new am4charts.DateAxis();
        axis.skipEmptyPeriods = true;
        switch (this.chartDataDateRange) {
          case SummariesChartDataDateRages.Yearly:
            axis.baseInterval = {
              'timeUnit': 'year',
              'count': 1
            };
            break;
          case SummariesChartDataDateRages.Monthly:
            axis.baseInterval = {
              'timeUnit': 'month',
              'count': 1
            };
            break;
          case SummariesChartDataDateRages.Daily:
            axis.baseInterval = {
              'timeUnit': 'day',
              'count': 1
            };
            break;
          case SummariesChartDataDateRages.Hourly:
            axis.baseInterval = {
              'timeUnit': 'hour',
              'count': 1
            };
            break;
          default:
            throw new Error(`Not implemented`);
        }
        axis.dateFormatter.dateFormat = this.getDateFormat(chartDateDateRange);
        return axis;
      case ChartDataCategoryTypes.ActivityType:
        return super.getCategoryAxis(chartDataCategoryType);
      default:
        throw new Error(`Not implemented`);
    }
  }

  protected getDateFormat(dateRange: SummariesChartDataDateRages) {
    switch (dateRange) {
      case SummariesChartDataDateRages.Yearly:
        return 'yyyy';
      case SummariesChartDataDateRages.Monthly:
        return'MMM yyyy';
      case SummariesChartDataDateRages.Daily:
        return 'dd MMM yyyy';
      case SummariesChartDataDateRages.Hourly:
        return 'HH:mm dd MMM yyyy';
      default:
        throw new Error(`Not implemented`)
    }
  }

  protected abstract generateChartData(data): SummariesChartDataInterface[];
}
