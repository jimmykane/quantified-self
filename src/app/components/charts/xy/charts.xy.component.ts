import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
} from '@angular/core';

import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';

import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { DashboardChartAbstractDirective } from '../dashboard-chart-abstract-component.directive';
import { AppEventColorService } from '../../../services/color/app.event.color.service';

import * as am4plugins_regression from '@amcharts/amcharts4/plugins/regression';
import { AppColors } from '../../../services/color/app.colors';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { ChartDataCategoryTypes, TimeIntervals } from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';


@Component({
    selector: 'app-xy-chart',
    templateUrl: './charts.xy.component.html',
    styleUrls: ['./charts.xy.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ChartsXYComponent extends DashboardChartAbstractDirective implements OnChanges, OnDestroy {


  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);
    // chart.exporting.menu = this.getExportingMenu();
    chart.hiddenState.properties.opacity = 0;
    chart.padding(10, 0, 0, 10);
    chart.paddingBottom = 20;
    chart.fontSize = '0.8em';

    // top container for labels
    const topContainer = chart.chartContainer.createChild(am4core.Container);
    topContainer.layout = 'absolute';
    topContainer.toBack();
    topContainer.paddingBottom = 5;
    topContainer.width = am4core.percent(100);
    // Title
    const chartTitle = topContainer.createChild(am4core.Label);
    chartTitle.align = 'left';
    chartTitle.adapter.add('text', (text, target, key) => {
      const data = target.parent.parent.parent.parent['data'];
      const value = this.getAggregateData(data, this.chartDataValueType);
      return `[font-size: 1.4em]${value.getDisplayType()}[/] [bold font-size: 1.3em]${value.getDisplayValue()}${value.getDisplayUnit()}[/] (${this.chartDataValueType}${this.chartDataCategoryType === ChartDataCategoryTypes.DateType ? ` @ ${TimeIntervals[this.chartDataTimeInterval]}` : ``})`;
    });
    chartTitle.marginTop = am4core.percent(20);
    const categoryAxis = chart.xAxes.push(this.getCategoryAxis(this.chartDataCategoryType, this.chartDataTimeInterval));
    if (categoryAxis instanceof am4charts.CategoryAxis) {
      categoryAxis.dataFields.category = 'type';
    } else if (categoryAxis instanceof am4charts.DateAxis) {
      categoryAxis.dataFields.date = 'time';
      chart.dateFormatter.dateFormat = categoryAxis.dateFormatter.dateFormat;
    }
    categoryAxis.renderer.grid.template.location = 0;
    categoryAxis.renderer.cellStartLocation = 0.1;
    categoryAxis.renderer.cellEndLocation = 0.9;
    categoryAxis.renderer.opposite = false
    categoryAxis.renderer.minGridDistance = 1
    categoryAxis.renderer.grid.template.disabled = false

    categoryAxis.renderer.labels.template.adapter.add('dy', (dy, target) => {
      if (target.dataItem && target.dataItem.index % 2) {
        return dy + 20;
      }
      return dy;
    });

    const valueAxis =  chart.yAxes.push(new am4charts.ValueAxis())
    valueAxis.renderer.opposite = true
    valueAxis.extraMax = 0.15
    valueAxis.numberFormatter = new am4core.NumberFormatter();
    valueAxis.numberFormatter.numberFormat = `#`;
    // valueAxis.numberFormatter.numberFormat = `#${DynamicDataLoader.getDataClassFromDataType(this.chartDataType).unit}`;
    valueAxis.renderer.labels.template.adapter.add('text', (text, target) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
      return `[bold font-size: 1.0em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
    });
    valueAxis.renderer.labels.template.adapter.add('dx', (text, target) => {
      return 15;
    });

    valueAxis.min = 0;

    let series;
    let regressionSeries: am4charts.XYSeries;

    series = chart.series.push(new am4charts.LineSeries());
    // series.filters.push(ChartHelper.getShadowFilter());

    series.stroke = chart.colors.getIndex(9); // Init stroke
    // series.tension = 1;
    const bullet = series.bullets.push(new am4charts.CircleBullet());
    bullet.circle.radius = 2;
    bullet.fillOpacity = 0.8;
    bullet.circle.radius = 3;
    bullet.adapter.add('fill', (fill, target) => {
      if (!target.dataItem) {
        return fill;
      }
      if (categoryAxis instanceof am4charts.CategoryAxis) {
        return am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext.type]))
      }
      return this.getFillColor(chart, target.dataItem.index);
    });

    bullet.adapter.add('stroke', (stroke, target) => {
      if (!target.dataItem) {
        return stroke;
      }
      if (categoryAxis instanceof am4charts.CategoryAxis) {
        return am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext.type]))
      }
      return this.getFillColor(chart, target.dataItem.index);
    });

    bullet.tooltipText = 'text';
    bullet.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[this.chartDataValueType]);
      return `{dateX}{categoryX}\n[bold]${this.chartDataValueType}: ${data.getDisplayValue()}${data.getDisplayUnit()}[/b]\n${target.dataItem.dataContext['count'] ? `[bold]${target.dataItem.dataContext['count']}[/b] Activities` : ``}`
    });
    // bullet.filters.push(ChartHelper.getShadowFilter());

    if (this.chartDataCategoryType === ChartDataCategoryTypes.DateType) {
      // Add the trend
      regressionSeries = chart.series.push(new am4charts.LineSeries());
      regressionSeries.strokeWidth = 1;
      regressionSeries.name = 'Linear Regression';
      regressionSeries.stroke = am4core.color(AppColors.DarkGray);
      regressionSeries.strokeOpacity = 1;
      regressionSeries.strokeDasharray = '10,5';
      const regressionPlugin = new am4plugins_regression.Regression();
      regressionPlugin.simplify = false;
      regressionSeries.plugins.push(regressionPlugin);
      // regressionSeries.filters.push(ChartHelper.getShadowFilter());
    }

    // @todo base on count !
    // This breaks on the count/categoy type
    if (this.data.length < 200) {
      const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
        categoryLabel.dy = -15;
      categoryLabel.label.adapter.add('text', (text, target) => {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(target.dataItem.dataContext[this.chartDataValueType]));
        return `[bold font-size: 1.1em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
      });
      categoryLabel.label.background = new am4core.RoundedRectangle();
      categoryLabel.label.background.fillOpacity = 1;
      categoryLabel.label.background.strokeOpacity = 1;
      // categoryLabel.label.background.fill = am4core.color(AppColors.LightGray);
      categoryLabel.label.adapter.add('stroke', (stroke, target) => {
        if (categoryAxis instanceof am4charts.CategoryAxis) {
          return am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext.type]))
        }
        return this.getFillColor(chart, target.dataItem.index)
      });
      categoryLabel.label.padding(1, 4, 0, 4);
      categoryLabel.label.hideOversized = false;
      categoryLabel.label.truncate = false;
      categoryLabel.label.adapter.add('fill', (fill, target) => {
        if (categoryAxis instanceof am4charts.CategoryAxis) {
          return am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext.type]))
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
    if (this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
      return 'categoryX';
    }
    if (this.chartDataCategoryType === ChartDataCategoryTypes.DateType) {
      return 'dateX';
    }
    return this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? 'categoryY' : 'dateY';
  }

  private getSeriesValueFieldName(): string {
    return this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? 'type' : 'time';
  }

  private getSeriesValuesFieldName(): string {
      return 'valueY';
  }
}
