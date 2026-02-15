import { ChartAbstractDirective } from './chart-abstract.directive';
import { AfterViewInit, ChangeDetectorRef, Directive, Input, NgZone, OnChanges } from '@angular/core';

import { SummariesChartDataInterface } from '../summaries/summaries.component';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes, TimeIntervals
} from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { DataInterface } from '@sports-alliance/sports-lib';

import { AmChartsService } from '../../services/am-charts.service';
import { LoggerService } from '../../services/logger.service';

// Type-only imports
import type * as am4core from '@amcharts/amcharts4/core';
import type * as am4charts from '@amcharts/amcharts4/charts';


@Directive()
export abstract class DashboardChartAbstractDirective extends ChartAbstractDirective implements OnChanges, AfterViewInit {
  @Input() data: any;
  @Input() chartDataType?: string;
  @Input() chartDataValueType?: ChartDataValueTypes;
  @Input() chartDataCategoryType?: ChartDataCategoryTypes;
  @Input() chartDataTimeInterval?: TimeIntervals;

  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected amChartsService: AmChartsService, protected logger: LoggerService) {
    super(zone, changeDetector, amChartsService, logger);
  }

  async ngAfterViewInit(): Promise<void> {
    // am4core options are now handled in AmChartsService
    this.chart = await this.createChart() as am4charts.XYChart;
    this.chart.data = this.data || [];
  }


  async ngOnChanges(simpleChanges): Promise<void> {
    this.isLoading ? this.loading() : this.loaded();
    // If there is a new theme we need to destroy the chart and readd the data;
    // If theme changes destroy the chart
    if (simpleChanges.chartTheme && this.chart) {
      this.destroyChart();
      this.chart = await this.createChart() as am4charts.XYChart;
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



  protected getCategoryAxis(chartDataCategoryType: ChartDataCategoryTypes, chartDataTimeInterval: TimeIntervals, charts: typeof am4charts): am4charts.CategoryAxis | am4charts.DateAxis | am4charts.Axis {
    switch (chartDataCategoryType) {
      case ChartDataCategoryTypes.DateType:
        const axis = new charts.DateAxis();

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
        return new charts.CategoryAxis();
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

  protected getDataInstanceOrNull(value: unknown): DataInterface | null {
    if (!this.chartDataType) {
      return null;
    }
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    try {
      return DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, numericValue) || null;
    } catch (error) {
      this.logger.warn('[DashboardChartAbstractDirective] Failed to create chart data instance', {
        chartDataType: this.chartDataType,
        numericValue,
        error
      });
      return null;
    }
  }

  protected getAggregateData(data: any[], chartDataValueType: ChartDataValueTypes): DataInterface | null {
    if (!Array.isArray(data) || !data.length || !chartDataValueType) {
      return null;
    }
    const numericValues = data
      .map(dataItem => Number(dataItem?.[chartDataValueType]))
      .filter(value => Number.isFinite(value));

    if (!numericValues.length) {
      return null;
    }

    switch (chartDataValueType) {
      case ChartDataValueTypes.Average:
        return this.getDataInstanceOrNull(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
      case ChartDataValueTypes.Maximum:
        return this.getDataInstanceOrNull(Math.max(...numericValues));
      case ChartDataValueTypes.Minimum:
        return this.getDataInstanceOrNull(Math.min(...numericValues));
      case ChartDataValueTypes.Total:
        return this.getDataInstanceOrNull(numericValues.reduce((sum, value) => sum + value, 0));
      default:
        return null;
    }
  }

  protected sortData(chartDataCategoryType: ChartDataCategoryTypes) {
    return (itemA: SummariesChartDataInterface, itemB: SummariesChartDataInterface) => chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? itemA[this.chartDataValueType] - itemB[this.chartDataValueType] : -(itemB.time - itemA.time);
  }
}
