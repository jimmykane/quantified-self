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
import animated from '@amcharts/amcharts4/themes/animated';

import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {ChartAbstract} from '../chart.abstract';
import {ChartDataValueTypes} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';
import {concat} from 'rxjs';
import {string} from '@amcharts/amcharts4/core';
import {DashboardChartAbstract} from '../dashboard-chart.abstract';
import {SummariesChartDataInterface} from '../../summaries/summaries.component';

@Component({
  selector: 'app-column-chart',
  templateUrl: './charts.column.component.html',
  styleUrls: ['./charts.column.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsColumnComponent extends DashboardChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() data: any;
  @Input() userChartSettings: UserChartSettingsInterface;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;
  @Input() vertical = true;
  @Input() filterLowValues: boolean;

  protected chart: am4charts.XYChart;
  protected logger = Log.create('ChartColumnComponent');

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(zone, changeDetector);
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart)

    chart.hiddenState.properties.opacity = 0;
    chart.padding(0, 0, 0, 20);
    chart.fontSize = '1.1em';

    // top container for labels
    const topContainer = chart.chartContainer.createChild(am4core.Container);
    topContainer.layout = 'absolute';
    topContainer.toBack();
    topContainer.paddingBottom = 5;
    topContainer.width = am4core.percent(100);

    const chartTitle = topContainer.createChild(am4core.Label);
    chartTitle.align = 'left';
    chartTitle.adapter.add('text', (text, target, key) => {
      const data = target.parent.parent.parent.parent['data'];
      const value = this.getAggregateData(data, this.chartDataValueType);
      return `[font-size: 1.3em]${value.getDisplayType()}[/] [bold font-size: 1.4em]${value.getDisplayValue()}${value.getDisplayUnit()}[/] (${this.chartDataValueType} )`;
    });


    // Disable the preloader
    chart.preloader.disabled = true;
    // chart.exporting.menu = this.getExportingMenu();

    const categoryAxis = this.vertical ? chart.xAxes.push(this.getCategoryAxis()) : chart.yAxes.push(this.getCategoryAxis());
    categoryAxis.dataFields.category = 'type';
    categoryAxis.renderer.grid.template.location = 0;
    categoryAxis.renderer.cellStartLocation = 0.1;
    categoryAxis.renderer.cellEndLocation = 0.9;
    if (this.vertical) {
      categoryAxis.renderer.minGridDistance = 20;
    } else {
      categoryAxis.renderer.minGridDistance = 1;
      categoryAxis.renderer.opposite = true;
    }

    if( this.vertical ) {
      // chart.marginBottom = 20;
      categoryAxis.renderer.labels.template.adapter.add('dy',  (dy, target) => {
        chart.paddingBottom = 20;
        // tslint:disable-next-line:no-bitwise
        if (chart.data.length > 5 && target.dataItem && target.dataItem.index%2) {
          return dy + 20;
        }
        return dy;
      });
    }

    const valueAxis = this.vertical ? chart.yAxes.push(new am4charts.ValueAxis()) : chart.xAxes.push(new am4charts.ValueAxis());
    valueAxis.extraMax = 0.20;

    if (this.vertical) {
      valueAxis.renderer.opposite = true;
      valueAxis.extraMax = 0.15;
    }
    valueAxis.numberFormatter = new am4core.NumberFormatter();
    valueAxis.numberFormatter.numberFormat = `#`;
    // valueAxis.numberFormatter.numberFormat = `#${DynamicDataLoader.getDataClassFromDataType(this.chartDataType).unit}`;
    valueAxis.renderer.labels.template.adapter.add('text', (text, target) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
      return `[bold font-size: 1.0em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}`
    });
    valueAxis.min = 0;


    let series;

    if (this.vertical) {
      series = chart.series.push(new am4charts.CurvedColumnSeries());
      series.dataFields.valueY = 'value';
      series.dataFields.categoryX = 'type';
      const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
      categoryLabel.label.adapter.add('text', (text, target) => {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(target.dataItem.dataContext.value));
        return `[bold font-size: 1.1em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}`
      });
      categoryLabel.dy = -15;
      categoryLabel.label.hideOversized = false;
      categoryLabel.label.truncate = false;
      categoryLabel.label.adapter.add('fill', (fill, target) => {
        return chart.colors.getIndex(target.dataItem.index);
      });
    } else {
      series = chart.series.push(new am4charts.ColumnSeries());
      series.dataFields.valueX = 'value';
      series.dataFields.categoryY = 'type';
      const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
      categoryLabel.label.adapter.add('text', (text, target) => {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(target.dataItem.dataContext.value));
        return `[bold font-size: 1.1em ]${data.getDisplayValue()}[/]${data.getDisplayUnit()}`
      });
      categoryLabel.label.dx = 50;
      categoryLabel.label.hideOversized = false;
      categoryLabel.label.truncate = false;
      categoryLabel.label.adapter.add('fill', (fill, target) => {
        return chart.colors.getIndex(target.dataItem.index);
      });
    }

    series.name = DynamicDataLoader.getDataClassFromDataType(this.chartDataType).type;
    series.columns.template.strokeOpacity = 1;
    series.columns.template.strokeWidth = 0.4;
    series.columns.template.stroke = am4core.color('#175e84');
    if (this.vertical) {
      series.columns.template.tension = 1;
    }
    // series.columns.template.fillOpacity = 1;
    series.columns.template.tooltipText = this.vertical ? '{valueY}' : '{valueX}';
    series.columns.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
      return `${this.vertical ? `{categoryX}` : '{categoryY}'} ${target.dataItem.dataContext['count'] ? `(x${target.dataItem.dataContext['count']})` : ``} [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b] (${this.chartDataValueType})`
    });

    // Add distinctive colors for each column using adapter
    series.columns.template.adapter.add('fill', (fill, target) => {
      return chart.colors.getIndex(target.dataItem.index);
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
      if (percent < 5) {
        if (!otherData) {
          otherData = {type: 'Other', value: dataItem.value, count: 1};
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
