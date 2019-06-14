import {
  AfterViewInit,
  ChangeDetectionStrategy,
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

@Component({
  selector: 'app-column-chart',
  templateUrl: './charts.column.component.html',
  styleUrls: ['./charts.column.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsColumnComponent extends ChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartDiv', {static: true}) chartDiv: ElementRef;
  @Input() data: any;
  @Input() userChartSettings: UserChartSettingsInterface;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() chartValueType: string;


  private dataSelected: any;

  protected chart: am4charts.XYChart;
  protected logger = Log.create('ChartColumnComponent');

  constructor(protected zone: NgZone) {
    super(zone);
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
    if (!this.data) {
      throw new Error('Component data');
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
    this.chart.data = this.data;
  }

  private createChart(): am4charts.XYChart {
    return this.zone.runOutsideAngular(() => {
      this.applyChartStylesFromUserSettings();

      // Create a chart
      // Remove Amcharts logo
      // @todo move this to a db setting ?
      am4core.options.commercialLicense = true;
      const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);
      chart.hiddenState.properties.opacity = 0;

      // Disable the preloader
      chart.preloader.disabled = true;
      chart.exporting.menu = this.getExportingMenu();

      const categoryAxis = chart.xAxes.push(new am4charts.CategoryAxis());
      categoryAxis.dataFields.category = 'type';
      categoryAxis.renderer.grid.template.location = 0;
      categoryAxis.renderer.minGridDistance = 40;

      // categoryAxis.renderer.labels.template.adapter.add("dy", function(dy, target) {
      //   if (target.dataItem && target.dataItem.index & 2 == 2) {
      //     return dy + 25;
      //   }
      //   return dy;
      // });

      const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      valueAxis.title.text = `${DynamicDataLoader.getDataClassFromDataType(this.chartValueType).type} ${DynamicDataLoader.getDataClassFromDataType(this.chartValueType).unit}`;


      const series = chart.series.push(new am4charts.CurvedColumnSeries());
      series.dataFields.valueY = 'value';
      series.dataFields.categoryX = 'type';
      series.name = this.chartValueType;
      series.columns.template.strokeOpacity = 1;
      series.columns.template.strokeWidth = 1;
      series.columns.template.tension = 1;
      series.columns.template.fillOpacity = 0.75;
      series.columns.template.tooltipText = '{valueY}';
      series.columns.template.adapter.add('tooltipText', (text, target, key) => {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartValueType, target.dataItem.dataContext['value']);
        return `{categoryX} [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
      });

      // Add distinctive colors for each column using adapter
      series.columns.template.adapter.add('fill', (fill, target) => {
        return chart.colors.getIndex(target.dataItem.index);
      });

      // Attach events
      this.attachEventListenersOnChart(chart);

      return chart;
    });
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
