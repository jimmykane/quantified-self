import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
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
import * as Sentry from '@sentry/browser';

@Component({
  selector: 'app-pie-chart',
  templateUrl: './charts.pie.component.html',
  styleUrls: ['./charts.pie.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsPieComponent extends ChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartDiv', {static: true}) chartDiv: ElementRef;
  @Input() data: any;
  @Input() userChartSettings: UserChartSettingsInterface;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() chartValueType: string;


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

    // 1. If there is no chart create
    if (!this.chart) {
      this.chart = this.createChart();
      this.chart.data = [];
    }


    if (!simpleChanges.data && !simpleChanges.chartTheme) {
      return;
    }

    if (!this.data) {
      return;
    }
    // To create an animation here it has to update the values of the data items
    const generatedData = this.generateChartData(this.data);
    // if (!this.chart.data.length) {
    this.chart.data = generatedData;
    return;
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

  private createChart(): am4charts.PieChart {
    return this.zone.runOutsideAngular(() => {
      this.applyChartStylesFromUserSettings();

      // Create a chart
      // Remove Amcharts logo
      // @todo move this to a db setting ?
      am4core.options.commercialLicense = true;
      const chart = am4core.create(this.chartDiv.nativeElement, am4charts.PieChart);
      chart.hiddenState.properties.opacity = 0;
      // chart.padding(0, 0, 0, 0)
      chart.radius = am4core.percent(70);
      chart.innerRadius = am4core.percent(50);

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
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartValueType, target.dataItem.dataContext['value']);
        return `{category} [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
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
          // return `[font-size: 1em]${target.dataItem.dataContext.type.split(' ').join('\n')}[/] [bold font-size: 1.2em]{value.percent.formatNumber('#.')}%[/]`
          return `[font-size: 1em]${target.dataItem.dataContext.type.slice(0, 70)}[/] [bold font-size: 1.2em]{value.percent.formatNumber('#.')}%[/]`
        } catch (e) {
          Sentry.captureException(e);
        }
      });


      const label = pieSeries.createChild(am4core.Label);
      label.horizontalCenter = 'middle';
      label.verticalCenter = 'middle';
      // label.fontSize = 12;
      label.html = `{values.value.sum.formatNumber('#')}`;
      label.adapter.add('htmlOutput', (text, target, key) => {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartValueType, Number(text));
        return `<p style="text-align: center; font-size: 1.3em">${data.getDisplayType()}</p>
                <p style="text-align: center; font-size: 1.4em; font-weight: bold">${data.getDisplayValue()}${data.getDisplayUnit()}</p>`
      });

      chart.exporting.menu = this.getExportingMenu();

      //
      // Disable the preloader
      chart.preloader.disabled = true;

      // Attach events
      this.attachEventListenersOnChart(chart);

      return chart;
    });
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


  private applyChartStylesFromUserSettings() {
    this.zone.runOutsideAngular(() => {
      am4core.unuseAllThemes();
      am4core.useTheme(this.themes[this.chartTheme]);
      if (this.userChartSettings && this.userChartSettings.useAnimations) {
        am4core.useTheme(animated);
      }
    });
  }
}
