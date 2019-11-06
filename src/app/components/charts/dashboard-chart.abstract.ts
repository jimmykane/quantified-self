import {ChartAbstract} from './chart.abstract';
import {ChangeDetectorRef, Input, NgZone, OnChanges} from '@angular/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {SummariesChartDataDateRages, SummariesChartDataInterface} from '../summaries/summaries.component';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes
} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';


export abstract class DashboardChartAbstract extends ChartAbstract implements OnChanges {
  @Input() data: any;
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes;
  @Input() filterLowValues: boolean;
  @Input() chartDataDateRange?: SummariesChartDataDateRages;

  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(zone, changeDetector);
    // am4core.options.onlyShowOnViewport = true;
    // am4core.options.queue = true;
  }

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

    this.data = this.data.sort(this.sortData(this.chartDataCategoryType));
    if (this.filterLowValues) {
      this.data = this.filterOutLowValues(this.data)
    }
    this.chart.data = this.data;
  }

  protected getCategoryAxis(chartDataCategoryType: ChartDataCategoryTypes, chartDateDateRange: SummariesChartDataDateRages): am4charts.CategoryAxis | am4charts.DateAxis | am4charts.Axis {
    switch (chartDataCategoryType) {
      case ChartDataCategoryTypes.DateType:
        const axis = new am4charts.DateAxis();
        let key;
        axis.skipEmptyPeriods = true;
        switch (this.chartDataDateRange) {
          case SummariesChartDataDateRages.Yearly:
            key = 'year';
            break;
          case SummariesChartDataDateRages.Monthly:
            key = 'month';
            break;
          case SummariesChartDataDateRages.Daily:
            key = 'day';
            break;
          case SummariesChartDataDateRages.Hourly:
            key = 'hour';
            break;
          default:
            throw new Error(`Not implemented`);
        }
        axis.baseInterval = {
          'timeUnit': key,
          'count': 1
        };
        axis.dateFormatter.dateFormat = this.getChartDateFormat(chartDateDateRange);
        axis.dateFormats.setKey(key, this.getAxisDateFormat(chartDateDateRange));
        axis.periodChangeDateFormats.setKey(key, this.getAxisDateFormat(chartDateDateRange));
        return axis;
      case ChartDataCategoryTypes.ActivityType:
        return super.getCategoryAxis(chartDataCategoryType);
      default:
        throw new Error(`Not implemented`);
    }
  }

  protected getChartDateFormat(dateRange: SummariesChartDataDateRages) {
    switch (dateRange) {
      case SummariesChartDataDateRages.Yearly:
        return 'yyyy';
      case SummariesChartDataDateRages.Monthly:
        return 'MMM yyyy';
      case SummariesChartDataDateRages.Daily:
        return 'dd MMM yyyy';
      case SummariesChartDataDateRages.Hourly:
        return 'HH:mm dd MMM yyyy';
      default:
        throw new Error(`Not implemented`)
    }
  }

  protected getAxisDateFormat(dateRange: SummariesChartDataDateRages) {
    switch (dateRange) {
      case SummariesChartDataDateRages.Yearly:
        return 'yyyy';
      case SummariesChartDataDateRages.Monthly:
        return 'MMM';
      case SummariesChartDataDateRages.Daily:
        return 'dd';
      case SummariesChartDataDateRages.Hourly:
        return 'HH:mm';
      default:
        throw new Error(`Not implemented`)
    }
  }

  protected getAggregateData(data: any, chartDataValueType: ChartDataValueTypes): DataInterface {
    switch (chartDataValueType) {
      case ChartDataValueTypes.Average:
        let count = 0;
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((sum, dataItem) => {
          count++;
          sum += dataItem.value;
          return sum;
        }, 0) / count);
      case ChartDataValueTypes.Maximum:
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((min, dataItem) => {
          min = min <= dataItem.value ? dataItem.value : min;
          return min;
        }, -Infinity));
      case ChartDataValueTypes.Minimum:
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((min, dataItem) => {
          min = min > dataItem.value ? dataItem.value : min;
          return min;
        }, Infinity));
      case ChartDataValueTypes.Total:
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((sum, dataItem) => {
          sum += dataItem.value;
          return sum;
        }, 0));
    }
  }

  protected filterOutLowValues(data: SummariesChartDataInterface[]): SummariesChartDataInterface[] {
    const chartData = [];
    let otherData: SummariesChartDataInterface;
    const baseValue = <number>this.getAggregateData(data, this.chartDataValueType).getValue() || 1;
    data.forEach((dataItem: SummariesChartDataInterface, index) => {
      const percent = (dataItem.value * 100) / baseValue; // problem with 0 base value
      if (percent < 5) {
        if (!otherData) {
          otherData = {type: 'Other', value: dataItem.value, count: 1}; // @todo -> This removes the item from the column list best todo is to create a new column series ?
          return;
        }
        otherData.value = <number>this.getAggregateData([otherData, dataItem], this.chartDataValueType).getValue(); // Important the -dataItem.value
        otherData.count++;
        return
      }
      chartData.push(dataItem);
    });
    if (otherData && isNumber(otherData.value)) {
      chartData.unshift(otherData)
    }
    return chartData;
  }

  protected sortData(chartDataCategoryType: ChartDataCategoryTypes) {
    return (itemA: SummariesChartDataInterface, itemB: SummariesChartDataInterface) => chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? itemA.value - itemB.value : -(itemB.time - itemA.time);
  }
}
