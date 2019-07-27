import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
} from '@angular/core';
import {Log} from 'ng2-logger/browser'
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {ChartAbstract} from '../chart.abstract';
import * as Sentry from '@sentry/browser';
import {ChartDataValueTypes} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';
// Chart Themes
import {isNumber} from 'quantified-self-lib/lib/events/utilities/helpers';


@Component({
  selector: 'app-pie-chart',
  templateUrl: './charts.pie.component.html',
  styleUrls: ['./charts.pie.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsPieComponent extends ChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() data: any;

  @Input() chartDataType: string;
  @Input() chartDataValueType: ChartDataValueTypes;

  public noData: boolean;

  private dataSelected: any;

  protected chart: am4charts.PieChart;
  protected logger = Log.create('ChartPieComponent');

  constructor(protected zone: NgZone) {
    super(zone);
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
    if (!this.data) {
      throw new Error('Component needs data');
    }
  }

  async ngOnChanges(simpleChanges) {
    // If theme changes destroy the chart
    if (simpleChanges.chartTheme) {
      this.destroyChart();
    }

    if (!this.data.length) {
      this.noData = true;
      return
    }

    this.noData = false;

    // 1. If there is no chart create
    if (!this.chart) {
      this.chart = this.createChart();
      this.chart.data = [];
    }


    if (!simpleChanges.data && !simpleChanges.chartTheme) {
      return;
    }


    // To create an animation here it has to update the values of the data items
    // if (!this.chart.data.length) {
    this.chart.data = this.generateChartData(this.data);
    // }


    // // Take out all data from the chart that do not exist on the new set
    // let removedSomeData = false;
    // for (let i = this.chart.data.length - 1; i >= 0; i--) {
    //   if (!generatedData.find(data => data.type === this.chart.data[i].type)) {
    //     this.chart.data.splice(i, 1);
    //     removedSomeData = true;
    //   }
    // }
    // // Go over all the new data
    // for (const data of generatedData) {
    //   const existingDataItem = this.chart.data.find(dataItem => data.type === dataItem.type);
    //   if (!existingDataItem) {
    //     this.chart.addData(data);
    //   } else {
    //     existingDataItem.value = data.value;
    //   }
    // }
    //
    // console.log(this.chart.data);
    // removedSomeData ? this.chart.invalidateData() : this.chart.invalidateRawData();
    // this.chart.series.each(series => {
    //   series.invalidateLayout()
    //   series.invalidateRawData()
    //   series.invalidateData();
    //   series.appear();
    // })

    // this.chart.invalidate()
    // this.generateChartData(this.data).forEach(data => this.chart.addData(data))
  }

  protected createChart(): am4charts.PieChart {
    const chart = <am4charts.PieChart>super.createChart(am4charts.PieChart);

    chart.hiddenState.properties.opacity = 0;
    // chart.padding(0, 0, 0, 0)
    chart.radius = am4core.percent(80);
    chart.innerRadius = am4core.percent(55);

    const pieSeries = chart.series.push(new am4charts.PieSeries());
    pieSeries.dataFields.value = 'value';
    pieSeries.dataFields.category = 'type';
    pieSeries.interpolationDuration = 500;
    pieSeries.rangeChangeDuration = 500;
    pieSeries.sequencedInterpolation = true;

    pieSeries.slices.template.propertyFields.isActive = 'pulled';
    pieSeries.slices.template.strokeWidth = 0.3;
    pieSeries.slices.template.strokeOpacity = 1;
    // pieSeries.slices.template.stroke = am4core.color('#0c96ff');
    pieSeries.slices.template.adapter.add('tooltipText', (text, target, key) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
      return `{category} - ${target.dataItem.values.value.percent.toFixed(1)}% - [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
    });
    pieSeries.slices.template.events.on('hit', (event) => {
      // const a = this.chart.data.find(dataItem => dataItem.type === 'Running');
      // debugger;
      // a.value = 100000;
      // this.chart.invalidateRawData()
      // if (event.target.dataItem.dataContext['id'] !== undefined) {
      //   this.dataSelected = event.target.dataItem.dataContext['id'];
      // } else {
      //   this.dataSelected  = null;
      // }
      // this.chart.data = this.generateChartData(this.data);
    });

    pieSeries.labels.template.adapter.add('text', (text, target, key) => {
      try {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
        if (target.dataItem.values.value.percent < 1) {
          return null;
        }
        if (!target.dataItem.dataContext.type) {
          return `???`;
        }
        return `[font-size: 1.1em]${target.dataItem.dataContext.type.slice(0, 40)}[/] [bold font-size: 1.2em]{value.percent.formatNumber('#.')}%[/]\n[bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
      } catch (e) {
        Sentry.captureException(e);
      }
    });

    const label = pieSeries.createChild(am4core.Label);
    label.horizontalCenter = 'middle';
    label.verticalCenter = 'middle';
    // label.fontSize = 12;
    if (this.chartDataValueType === ChartDataValueTypes.Total) {
      label.text = `{values.value.sum.formatNumber('#')}`;
    }
    if (this.chartDataValueType === ChartDataValueTypes.Maximum) {
      label.text = `{values.value.high.formatNumber('#')}`;
    }
    if (this.chartDataValueType === ChartDataValueTypes.Minimum) {
      label.text = `{values.value.low.formatNumber('#')}`;
    }
    if (this.chartDataValueType === ChartDataValueTypes.Average) {
      label.text = `{values.value.average.formatNumber('#')}`;
    }
    label.adapter.add('textOutput', (text, target, key) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
      return `[font-size: 1.3em]${data.getDisplayType()}[/]
              [font-size: 1.4em]${data.getDisplayValue()}${data.getDisplayUnit()}[/]
              [font-size: 1.0em]${this.chartDataValueType}[/]`
    });
    // label.adapter.add('htmlOutput', (text, target, key) => {
    //   const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
    //   return `<div style="text-align: center; font-size: 1.3em;">${data.getDisplayType()}</div>
    //             <div style="text-align: center; font-size: 1.4em; font-weight: bold">${data.getDisplayValue()}${data.getDisplayUnit()}</div>
    //             <div style="text-align: center; font-size: 1.0em; ">${this.chartDataValueType}</div>`;
    // });

    // chart.exporting.menu = this.getExportingMenu();

    //
    // Disable the preloader
    chart.preloader.disabled = true;

    // Attach events
    this.attachEventListenersOnChart(chart);
    return chart;
  }

  private generateChartData(data) {
    const chartData = [];
    for (let i = 0; i < data.length; i++) {
      if (i === this.dataSelected) {
        for (let x = 0; x < data[i].subs.length; x++) {
          chartData.push({
            type: data[i].subs[x].type,
            value: data[i].subs[x].value,
            pulled: true
          });
        }
      } else {
        chartData.push({
          type: data[i].type,
          value: data[i].value,
          id: i
        });
      }
    }
    return chartData;
  }
}
