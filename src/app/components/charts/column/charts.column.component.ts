import {
  AfterViewInit,
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import {Log} from 'ng2-logger/browser'
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {ChartThemes, UserChartSettingsInterface} from 'quantified-self-lib/lib/users/user.chart.settings.interface';
// Chart Themes

import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes
} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {DashboardChartAbstract} from '../dashboard-chart.abstract';
import {SummariesChartDataInterface} from '../../summaries/summaries.component';

@Component({
  selector: 'app-column-chart',
  templateUrl: './charts.column.component.html',
  styleUrls: ['./charts.column.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsColumnComponent extends DashboardChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() vertical = true;

  protected logger = Log.create('ChartColumnComponent');

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(zone, changeDetector);
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);
    // Disable the preloader
    chart.preloader.disabled = true;
    // chart.exporting.menu = this.getExportingMenu();
    chart.hiddenState.properties.opacity = 0;
    chart.padding(0, 0, 0, 20);
    chart.fontSize = '1.1em';
    chart.paddingBottom = 20;


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
      return `[font-size: 1.3em]${value.getDisplayType()}[/] [bold font-size: 1.4em]${value.getDisplayValue()}${value.getDisplayUnit()}[/] (${this.chartDataValueType} )`;
    });


    const categoryAxis = this.vertical ? chart.xAxes.push(this.getCategoryAxis(this.chartDataCategoryType, this.chartDataDateRange)) : chart.yAxes.push(this.getCategoryAxis(this.chartDataCategoryType, this.chartDataDateRange));
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
    categoryAxis.renderer.labels.template.adapter.add('dy', (dy, target) => {
      if (this.vertical && chart.data.length > 5 && target.dataItem && target.dataItem.index % 2) {
        return dy + 20;
      }
      return dy;
    });



    const valueAxis = this.vertical ? chart.yAxes.push(new am4charts.ValueAxis()) : chart.xAxes.push(new am4charts.ValueAxis());
    valueAxis.renderer.opposite = this.vertical;
    valueAxis.extraMax = this.vertical ? 0.15 : 0.20;
    valueAxis.numberFormatter = new am4core.NumberFormatter();
    valueAxis.numberFormatter.numberFormat = `#`;
    // valueAxis.numberFormatter.numberFormat = `#${DynamicDataLoader.getDataClassFromDataType(this.chartDataType).unit}`;
    valueAxis.renderer.labels.template.adapter.add('text', (text, target) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
      return `[bold font-size: 1.0em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
    });
    valueAxis.min = 0;

    let series;

    series = this.vertical ? chart.series.push(new am4charts.CurvedColumnSeries()) : chart.series.push(new am4charts.ColumnSeries());

    const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
    if (this.vertical) {
      if (categoryAxis instanceof am4charts.CategoryAxis){
        series.dataFields.categoryX = 'type';
      }else if (categoryAxis instanceof am4charts.DateAxis){
        series.dataFields.dateX = 'time';
      }
      series.dataFields.valueY = 'value';
      series.columns.template.tension = 1;
      categoryLabel.dy = -15;

    } else {
      if (categoryAxis instanceof am4charts.CategoryAxis){
        series.dataFields.categoryY = 'type';
      }else if (categoryAxis instanceof am4charts.DateAxis){
        series.dataFields.dateY = 'time';
      }
      series.dataFields.valueX = 'value';
      categoryLabel.label.dx = 50;
    }

    categoryLabel.label.adapter.add('text', (text, target) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(target.dataItem.dataContext.value));
      return `[bold font-size: 1.1em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
    });

    categoryLabel.label.hideOversized = false;
    categoryLabel.label.truncate = false;
    categoryLabel.label.adapter.add('fill', (fill, target) => {
      return this.getFillColor(chart, target.dataItem.index)
    });

    series.name = DynamicDataLoader.getDataClassFromDataType(this.chartDataType).type;
    // series.groupFields.valueY = "sum";
    // series.groupFields.valueX = "sum";
    series.columns.template.strokeOpacity = this.getStrokeOpacity();
    series.columns.template.strokeWidth = this.getStrokeWidth();
    series.columns.template.stroke = am4core.color('#175e84');
    // series.columns.template.fillOpacity = 1;
    series.columns.template.tooltipText = this.vertical ? '{valueY}' : '{valueX}';
    series.columns.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
      return `${this.vertical ? `{dateX}{categoryX}` : '{dateY}{categoryY}'} ${target.dataItem.dataContext['count'] ? `(x${target.dataItem.dataContext['count']})` : ``} [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b] (${this.chartDataValueType})`
    });

    // Add distinctive colors for each column using adapter
    series.columns.template.adapter.add('fill', (fill, target) => {
      return this.getFillColor(chart, target.dataItem.index);
    });

    // Attach events
    // this.attachEventListenersOnChart(chart);

    return chart;
  }

  protected generateChartData(data): SummariesChartDataInterface[] {
    if (!this.filterLowValues) {
      return data;
    }
    const chartData = [];
    let otherData: SummariesChartDataInterface;
    const baseValue = <number>this.getAggregateData(data, this.chartDataValueType).getValue() || 1;
    data.forEach((dataItem: SummariesChartDataInterface, index) => {
      const percent = (dataItem.value * 100) / baseValue; // problem with 0 base value
      console.log(percent)
      if (percent < 5) {
        if (!otherData) {
          otherData = {type: 'Other',  value: dataItem.value, count: 1}; // @todo -> This removes the item from the column list best todo is to create a new column series ?
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

  private getAggregateData(data: any, chartDataValueType: ChartDataValueTypes): DataInterface {
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
}
