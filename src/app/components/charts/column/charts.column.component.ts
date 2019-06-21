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
  @Input() vertical = true;

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
    this.chart.invalidateLabels()

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
        return `[font-size: 1.3em]${DynamicDataLoader.getDataClassFromDataType(this.chartValueType).type}[/] [bold font-size: 1.4em]${target.parent.parent.parent.parent['data'].reduce((sum, data) => {
          sum += data.value;
          return sum;
        }, 0).toFixed(1)}${DynamicDataLoader.getDataClassFromDataType(this.chartValueType).unit}[/]`;
      });


      // Disable the preloader
      chart.preloader.disabled = true;
      chart.exporting.menu = this.getExportingMenu();

      const categoryAxis = this.vertical ? chart.xAxes.push(new am4charts.CategoryAxis()) : chart.yAxes.push(new am4charts.CategoryAxis());
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

      // if(this.vertical ) {
      //   categoryAxis.renderer.labels.template.adapter.add("dy",  (dy, target) => {
      //     if (chart.data.length > 4 && target.dataItem && target.dataItem.index & true) {
      //       return dy + 25;
      //       chart.paddingBottom = 20;
      //     }
      //     return dy;
      //   });
      // }

      const valueAxis = this.vertical ? chart.yAxes.push(new am4charts.ValueAxis()) : chart.xAxes.push(new am4charts.ValueAxis());
      valueAxis.extraMax = 0.20;

      if (this.vertical) {
        valueAxis.renderer.opposite = true;
        valueAxis.extraMax = 0.15;
      }
      valueAxis.numberFormatter = new am4core.NumberFormatter();
      valueAxis.numberFormatter.numberFormat = `#${DynamicDataLoader.getDataClassFromDataType(this.chartValueType).unit}`;
      valueAxis.min = 0;
      // chart.events.on('dataitemsvalidated', function(ev) {
      //   // valueAxis.max = Math.max(...ev.target.data.map(o => o.value), 0) + (Math.max(...ev.target.data.map(o => o.value), 0)* 0.05);
      //   // valueAxis.strictMinMax = true;
      //   // chart.invalidateLayout()
      //   // valueAxis.min =0 ;
      // });


      let series;

      if (this.vertical) {
        series = chart.series.push(new am4charts.CurvedColumnSeries());
        series.dataFields.valueY = 'value';
        series.dataFields.categoryX = 'type';
        const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
        categoryLabel.label.adapter.add('text', (text, target) => {
          const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartValueType, Number(target.dataItem.dataContext.value));
          return `[bold font-size: 1.3em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}`
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
          const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartValueType, Number(target.dataItem.dataContext.value));
          return `[bold font-size: 1.3em ]${data.getDisplayValue()}[/]${data.getDisplayUnit()}`
        });
        categoryLabel.label.dx = 50;
        categoryLabel.label.hideOversized = false;
        categoryLabel.label.truncate = false;
        categoryLabel.label.adapter.add('fill', (fill, target) => {
          return chart.colors.getIndex(target.dataItem.index);
        });
      }

      series.name = DynamicDataLoader.getDataClassFromDataType(this.chartValueType).type;
      series.columns.template.strokeOpacity = 1;
      series.columns.template.strokeWidth = 0.5;
      if (this.vertical) {
        series.columns.template.tension = 1;
      }
      series.columns.template.fillOpacity = 0.95;
      series.columns.template.tooltipText = this.vertical ? '{valueY}' : '{valueX}';
      series.columns.template.adapter.add('tooltipText', (text, target, key) => {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartValueType, target.dataItem.dataContext['value']);
        return `${this.vertical ? '{categoryX}' : '{categoryY}'} [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
      });

      // Add distinctive colors for each column using adapter
      series.columns.template.adapter.add('fill', (fill, target) => {
        return chart.colors.getIndex(target.dataItem.index);
      });

      // Attach events
      // this.attachEventListenersOnChart(chart);

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
