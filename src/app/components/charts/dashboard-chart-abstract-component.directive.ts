import { ChartAbstractDirective } from './chart-abstract.directive';
import { AfterViewInit, ChangeDetectorRef, Directive, Input, NgZone, OnChanges } from '@angular/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import { SummariesChartDataInterface } from '../summaries/summaries.component';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes, TimeIntervals
} from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';
import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { DataInterface } from '@sports-alliance/sports-lib/lib/data/data.interface';
import * as am4core from '@amcharts/amcharts4/core';

@Directive()
export abstract class DashboardChartAbstractDirective extends ChartAbstractDirective implements OnChanges, AfterViewInit {
  @Input() data: any;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;

  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(zone, changeDetector);
  }

  ngAfterViewInit(): void {
    am4core.options.queue = true;
    am4core.options.onlyShowOnViewport = true;
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
      // @todo this might change even if not needed
      // @todo not sure if "important" as the caller also does the same
      this.data = [...this.data].sort(this.sortData(this.chartDataCategoryType)); // Important to create new array
      if (this.chart) {
        this.chart.data = this.data || [];
        // @todo should it also invalidate?
        this.chart.invalidateLabels();
      }
    }
  }


  protected getCategoryAxis(chartDataCategoryType: ChartDataCategoryTypes, chartDataTimeInterval: TimeIntervals): am4charts.CategoryAxis | am4charts.DateAxis | am4charts.Axis {
    switch (chartDataCategoryType) {
      case ChartDataCategoryTypes.DateType:
        const axis = new am4charts.DateAxis();
        let key;
        axis.skipEmptyPeriods = true;
        switch (chartDataTimeInterval) {
          case TimeIntervals.Yearly:
            key = 'year';
            break;
          case TimeIntervals.Monthly:
            key = 'month';
            break;
          case TimeIntervals.Weekly:
            key = 'week';
            break;
          case TimeIntervals.Daily:
            key = 'day';
            break;
          case TimeIntervals.Hourly:
            key = 'hour';
            break;
          default:
            throw new Error(`Not implemented for ${chartDataTimeInterval}`);
        }
        axis.baseInterval = {
          'timeUnit': key,
          'count': 1
        };
        axis.dateFormatter.dateFormat = this.getChartDateFormat(chartDataTimeInterval);
        axis.dateFormats.setKey(key, this.getAxisDateFormat(chartDataTimeInterval));
        axis.periodChangeDateFormats.setKey(key, this.getAxisDateFormat(chartDataTimeInterval));
        return axis;
      case ChartDataCategoryTypes.ActivityType:
        return new am4charts.CategoryAxis();
      default:
        throw new Error(`Not implemented`);
    }
  }

  protected getChartDateFormat(timeInterval: TimeIntervals) {
    switch (timeInterval) {
      case TimeIntervals.Yearly:
        return 'yyyy';
      case TimeIntervals.Monthly:
        return 'MMM yyyy';
      case TimeIntervals.Weekly:
        return `'Week' ww dd MMM yyyy`;
      case TimeIntervals.Daily:
        return 'dd MMM yyyy';
      case TimeIntervals.Hourly:
        return 'HH:mm dd MMM yyyy';
      default:
        throw new Error(`Not implemented`)
    }
  }

  protected getAxisDateFormat(timeInterval: TimeIntervals) {
    switch (timeInterval) {
      case TimeIntervals.Yearly:
        return 'yyyy';
      case TimeIntervals.Monthly:
        return 'MMM';
      case TimeIntervals.Weekly:
        return 'ww';
      case TimeIntervals.Daily:
        return 'dd';
      case TimeIntervals.Hourly:
        return 'HH:mm';
      default:
        throw new Error(`Not implemented`)
    }
  }

  protected getAggregateData(data: any[], chartDataValueType: ChartDataValueTypes): DataInterface {
    switch (chartDataValueType) {
      case ChartDataValueTypes.Average:
        let count = 0;
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((sum, dataItem) => {
          count++;
          sum += dataItem[chartDataValueType];
          return sum;
        }, 0) / count);
      case ChartDataValueTypes.Maximum:
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((min, dataItem) => {
          min = min <= dataItem[chartDataValueType] ? dataItem[chartDataValueType] : min;
          return min;
        }, -Infinity));
      case ChartDataValueTypes.Minimum:
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((min, dataItem) => {
          min = min > dataItem[chartDataValueType] ? dataItem[chartDataValueType] : min;
          return min;
        }, Infinity));
      case ChartDataValueTypes.Total:
        return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, data.reduce((sum, dataItem) => {
          sum += dataItem[chartDataValueType];
          return sum;
        }, 0));
    }
  }

  protected sortData(chartDataCategoryType: ChartDataCategoryTypes) {
    return (itemA: SummariesChartDataInterface, itemB: SummariesChartDataInterface) => chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? itemA[this.chartDataValueType] - itemB[this.chartDataValueType] : -(itemB.time - itemA.time);
  }
}
