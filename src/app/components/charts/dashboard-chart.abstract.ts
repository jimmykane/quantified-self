import {ChartAbstractDirective} from './chart-abstract.directive';
import {AfterViewInit, ChangeDetectorRef, Directive, Input, NgZone, OnChanges} from '@angular/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {SummariesChartDataDateRages, SummariesChartDataInterface} from '../summaries/summaries.component';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import {DynamicDataLoader} from '@sports-alliance/sports-lib/lib/data/data.store';
import {DataInterface} from '@sports-alliance/sports-lib/lib/data/data.interface';
import {isNumber} from '@sports-alliance/sports-lib/lib/events/utilities/helpers';
import * as am4core from '@amcharts/amcharts4/core';


@Directive()
export abstract class DashboardChartAbstract extends ChartAbstractDirective implements OnChanges, AfterViewInit {
  @Input() data: any;
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() chartDataCategoryType: ChartDataCategoryTypes;
  @Input() filterLowValues: boolean;
  @Input() chartDataDateRange?: SummariesChartDataDateRages;
  @Input() isLoading: boolean;

  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(zone, changeDetector);
  }

  ngAfterViewInit(): void {
    am4core.options.queue = true;
    // am4core.options.onlyShowOnViewport = true;
    this.chart = <am4charts.XYChart>this.createChart();
    this.chart.data = this.data || [];
  }

  ngOnChanges(simpleChanges) {
    this.isLoading ? this.loading() : this.loaded();
    // If there is a new theme we need to destroy the chart and readd the data;
    // If theme changes destroy the chart
    if (simpleChanges.chartTheme && this.chart) {
      this.destroyChart();
      this.chart = <am4charts.XYChart>this.createChart();
      this.chart.data = this.data || [];
    }

    if (!this.data) {
      return;
    }

    if (simpleChanges.data) {
      this.data = [...this.data].sort(this.sortData(this.chartDataCategoryType)); // Important to create new array
      if (this.filterLowValues) {
        this.data = this.filterOutLowValues(this.data)
      }
      if (this.chart) {
        this.chart.data = this.data || [];
        // @todo should it also invalidate?
        this.chart.invalidateLabels();
      }
    }
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
        return new am4charts.CategoryAxis();
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

  // @todo this needs major refactor
  protected filterOutLowValues(data: SummariesChartDataInterface[]): SummariesChartDataInterface[] {
    const chartData = [];
    let otherData: SummariesChartDataInterface;
    const baseValue = <number>this.getAggregateData(data, this.chartDataValueType).getValue() || 1;
    const totalValue = <number>this.getAggregateData(data, ChartDataValueTypes.Total).getValue();
    data.forEach((dataItem: SummariesChartDataInterface, index) => {
      const percent = (dataItem.value * 100) / totalValue; // problem with 0 base value
      if (percent < 5) {
        if (!otherData) {
          otherData = {type: 'Other', value: dataItem.value, count: 1}; // @todo -> This removes the item from the column list best todo is to create a new column series ?
          return;
        }
        otherData.value = <number>this.getAggregateData([otherData, dataItem], this.chartDataValueType).getValue();
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
