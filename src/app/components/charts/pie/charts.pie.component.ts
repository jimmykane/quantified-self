import {
  AfterViewInit,
  ChangeDetectionStrategy, ChangeDetectorRef,
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
import * as am4plugins_sliceGrouper from '@amcharts/amcharts4/plugins/sliceGrouper';
import {group} from '@angular/animations';
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
  @Input() filterLowValues: boolean;


  public noData: boolean;

  private dataSelected: any;

  protected chart: am4charts.PieChart;
  protected logger = Log.create('ChartPieComponent');

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(zone, changeDetector);
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
    this.chart.data = this.generateChartData(this.data);
  }

  protected createChart(): am4charts.PieChart {
    const chart = <am4charts.PieChart>super.createChart(am4charts.PieChart);

    // chart.hiddenState.properties.opacity = 0;
    // chart.padding(0, 0, 0, 0)
    chart.radius = am4core.percent(80);
    chart.innerRadius = am4core.percent(55);

    const pieSeries = chart.series.push(new am4charts.PieSeries());
    pieSeries.dataFields.value = 'value';
    pieSeries.dataFields.category = 'type';
    // pieSeries.interpolationDuration = 500;
    // pieSeries.rangeChangeDuration = 500;
    // pieSeries.sequencedInterpolation = true;

    pieSeries.slices.template.propertyFields.isActive = 'pulled';
    pieSeries.slices.template.strokeWidth = 0.4;
    pieSeries.slices.template.strokeOpacity = 1;
    pieSeries.slices.template.stroke = am4core.color('#175e84');
    pieSeries.slices.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.values || ! target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
      return `{category} - ${target.dataItem.values.value.percent.toFixed(1)}% - [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
    });

    pieSeries.labels.template.adapter.add('text', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.values || !target.dataItem.dataContext) {
        return '';
      }
      try {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
        if (target.dataItem.values.value.percent <= 1 && this.filterLowValues) {
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

    // chart.exporting.menu = this.getExportingMenu();

    // Disable the preloader
    chart.preloader.disabled = true;

    const grouper = pieSeries.plugins.push(new am4plugins_sliceGrouper.SliceGrouper());
    grouper.threshold = 5;
    grouper.groupName = 'Other';
    grouper.clickBehavior = 'zoom';
    grouper.zoomOutButton.align = 'left';
    grouper.zoomOutButton.width = 35;
    grouper.zoomOutButton.valign = 'top';

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
