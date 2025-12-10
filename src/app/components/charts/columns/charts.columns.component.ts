import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
} from '@angular/core';

import type * as am4core from '@amcharts/amcharts4/core';
import type * as am4charts from '@amcharts/amcharts4/charts';

import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { DashboardChartAbstractDirective } from '../dashboard-chart-abstract-component.directive';
import { AppEventColorService } from '../../../services/color/app.event.color.service';

import type * as am4plugins_regression from '@amcharts/amcharts4/plugins/regression';
import { AppColors } from '../../../services/color/app.colors';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { ChartDataCategoryTypes, TimeIntervals } from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';


@Component({
  selector: 'app-columns-chart',
  templateUrl: './charts.columns.component.html',
  styleUrls: ['./charts.columns.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsColumnsComponent extends DashboardChartAbstractDirective implements OnChanges, OnDestroy {
  @Input() vertical = true;
  @Input() type: 'columns' | 'pyramids';

  private _am4core: typeof am4core;
  private _am4charts: typeof am4charts;


  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  protected async createChart(): Promise<am4charts.XYChart> {
    const { am4core, am4charts } = await this.loadAmCharts();
    this._am4core = am4core;
    this._am4charts = am4charts;
    const chart = <am4charts.XYChart>(await super.createChart(am4charts.XYChart));
    // chart.exporting.menu = this.getExportingMenu();
    chart.hiddenState.properties.opacity = 0;
    chart.padding(10, 0, 0, 10);
    chart.paddingBottom = this.vertical ? 20 : 0;
    chart.fontSize = '0.8em';

    // top container for labels
    const topContainer = chart.chartContainer.createChild(this._am4core.Container);
    topContainer.layout = 'absolute';
    topContainer.toBack();
    topContainer.paddingBottom = 5;
    topContainer.width = this._am4core.percent(100);
    // Title
    const chartTitle = topContainer.createChild(this._am4core.Label);
    chartTitle.align = 'left';
    chartTitle.adapter.add('text', (text, target, key) => {
      const data = target.parent.parent.parent.parent['data'];
      const value = this.getAggregateData(data, this.chartDataValueType);
      return `[font-size: 1.4em]${value.getDisplayType()}[/] [bold font-size: 1.3em]${value.getDisplayValue()}${value.getDisplayUnit()}[/] (${this.chartDataValueType}${this.chartDataCategoryType === ChartDataCategoryTypes.DateType ? ` @ ${TimeIntervals[this.chartDataTimeInterval]}` : ``})`;
    });
    chartTitle.marginTop = this._am4core.percent(20);
    const categoryAxis = this.vertical ? chart.xAxes.push(this.getCategoryAxis(this.chartDataCategoryType, this.chartDataTimeInterval, am4charts)) : chart.yAxes.push(this.getCategoryAxis(this.chartDataCategoryType, this.chartDataTimeInterval, am4charts));
    if (categoryAxis instanceof am4charts.CategoryAxis) {
      categoryAxis.dataFields.category = 'type';
    } else if (categoryAxis instanceof am4charts.DateAxis) {
      categoryAxis.dataFields.date = 'time';
      chart.dateFormatter.dateFormat = categoryAxis.dateFormatter.dateFormat;
    }
    categoryAxis.renderer.grid.template.location = 0;
    categoryAxis.renderer.cellStartLocation = 0.1;
    categoryAxis.renderer.cellEndLocation = 0.9;
    categoryAxis.renderer.opposite = !this.vertical;
    categoryAxis.renderer.minGridDistance = this.vertical ? 1 : 1;
    categoryAxis.renderer.grid.template.disabled = this.vertical || (categoryAxis instanceof am4charts.CategoryAxis);

    categoryAxis.renderer.labels.template.adapter.add('dy', (dy, target) => {
      if (this.vertical && target.dataItem && target.dataItem.index % 2) {
        return dy + 20;
      }
      return dy;
    });

    const valueAxis = this.vertical ? chart.yAxes.push(new this._am4charts.ValueAxis()) : chart.xAxes.push(new this._am4charts.ValueAxis());
    valueAxis.renderer.opposite = this.vertical;
    valueAxis.extraMax = this.vertical ? 0.15 : 0.15;
    valueAxis.numberFormatter = new this._am4core.NumberFormatter();
    valueAxis.numberFormatter.numberFormat = `#`;
    // valueAxis.numberFormatter.numberFormat = `#${DynamicDataLoader.getDataClassFromDataType(this.chartDataType).unit}`;
    valueAxis.renderer.labels.template.adapter.add('text', (text, target) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
      return `[bold font-size: 1.0em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
    });
    valueAxis.renderer.labels.template.adapter.add('dx', (text, target) => {
      // console.log(target.dataItem.index);
      return (target.dataItem.index === 2 && !this.vertical) ? 15 : 0;
    });

    // valueAxis.renderer.minLabelPosition = this.vertical ? 0 : 0.005;
    // valueAxis.renderer.minGridDistance = this.vertical ?  0 : 200;
    valueAxis.min = 0;

    let series;
    let regressionSeries: am4charts.XYSeries;

    series = this.vertical && this.type === 'pyramids' ? chart.series.push(new this._am4charts.CurvedColumnSeries()) : chart.series.push(new this._am4charts.ColumnSeries());
    series.columns.template.tension = this.vertical && this.type === 'pyramids' ? 1 : 0;
    series.columns.template.strokeOpacity = this.getStrokeOpacity();
    series.columns.template.strokeWidth = this.getStrokeWidth();
    series.columns.template.stroke = this._am4core.color('#175e84');
    series.columns.template.fillOpacity = 1;
    series.columns.template.tooltipText = this.vertical ? '{valueY}' : '{valueX}';
    series.columns.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[this.chartDataValueType]);
      return `${this.vertical ? `{dateX}{categoryX}` : '{dateY}{categoryY}'}\n[bold]${this.chartDataValueType}: ${data.getDisplayValue()}${data.getDisplayUnit()}[/b]\n${target.dataItem.dataContext['count'] ? `[bold]${target.dataItem.dataContext['count']}[/b] Activities` : ``}`
    });

    // Add distinctive colors for each column using adapter
    series.columns.template.adapter.add('fill', (fill, target) => {
      if (categoryAxis instanceof am4charts.CategoryAxis) {
        return this._am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext.type]))
      }
      return this.getFillColor(chart, target.dataItem.index);
    });


    // series.columns.template.filters.push(ChartHelper.getShadowFilter());

    if (this.type === 'columns') {
      this.vertical ? series.columns.template.column.cornerRadiusTopLeft = 2 : series.columns.template.column.cornerRadiusTopRight = 2;
      this.vertical ? series.columns.template.column.cornerRadiusTopRight = 2 : series.columns.template.column.cornerRadiusBottomRight = 2;
    }

    if (this.vertical && this.chartDataCategoryType === ChartDataCategoryTypes.DateType) {
      // Add the trend
      regressionSeries = chart.series.push(new this._am4charts.LineSeries());
      regressionSeries.strokeWidth = 1;
      regressionSeries.name = 'Linear Regression';
      regressionSeries.stroke = this._am4core.color(AppColors.DarkGray);
      regressionSeries.strokeOpacity = 1;
      regressionSeries.strokeDasharray = '10,5';
      const am4plugins_regression = await import('@amcharts/amcharts4/plugins/regression');
      const regressionPlugin = new am4plugins_regression.Regression();
      regressionPlugin.simplify = false;
      regressionSeries.plugins.push(regressionPlugin);
      // regressionSeries.filters.push(ChartHelper.getShadowFilter());
    }

    // @todo base on count !
    // This breaks on the count/categoy type
    if (this.data.length < 200) {
      const categoryLabel = series.bullets.push(new this._am4charts.LabelBullet());
      if (this.vertical) {
        categoryLabel.dy = -15;
      } else {
        categoryLabel.label.dx = 40;
      }
      categoryLabel.label.adapter.add('text', (text, target) => {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(target.dataItem.dataContext[this.chartDataValueType]));
        return `[bold font-size: 1.1em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
      });
      categoryLabel.label.background = new this._am4core.RoundedRectangle();
      categoryLabel.label.background.fillOpacity = 1;
      categoryLabel.label.background.strokeOpacity = 1;
      // categoryLabel.label.background.fill = this._am4core.color(AppColors.LightGray);
      categoryLabel.label.adapter.add('stroke', (stroke, target) => {
        if (categoryAxis instanceof am4charts.CategoryAxis) {
          return this._am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext.type]))
        }
        return this.getFillColor(chart, target.dataItem.index)
      });
      categoryLabel.label.padding(1, 4, 0, 4);
      categoryLabel.label.hideOversized = false;
      categoryLabel.label.truncate = false;
      categoryLabel.label.adapter.add('fill', (fill, target) => {
        if (categoryAxis instanceof am4charts.CategoryAxis) {
          return this._am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext.type]))
        }
        return this.getFillColor(chart, target.dataItem.index)
      });
    }
    series.dataFields[this.getSeriesCategoryFieldName()] = this.getSeriesValueFieldName();
    series.dataFields[this.getSeriesValuesFieldName()] = this.chartDataValueType;

    if (regressionSeries) {
      regressionSeries.dataFields[this.getSeriesCategoryFieldName()] = this.getSeriesValueFieldName();
      regressionSeries.dataFields[this.getSeriesValuesFieldName()] = this.chartDataValueType;
    }

    series.name = DynamicDataLoader.getDataClassFromDataType(this.chartDataType).type;
    return chart;
  }

  private getSeriesCategoryFieldName(): string {
    if (this.vertical && this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
      return 'categoryX';
    }
    if (this.vertical && this.chartDataCategoryType === ChartDataCategoryTypes.DateType) {
      return 'dateX';
    }
    return this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? 'categoryY' : 'dateY';
  }

  private getSeriesValueFieldName(): string {
    return this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? 'type' : 'time';
  }

  private getSeriesValuesFieldName(): string {
    if (this.vertical) {
      return 'valueY';
    }
    return 'valueX';
  }
}
