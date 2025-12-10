import { ChangeDetectorRef, ElementRef, Input, NgZone, OnDestroy, ViewChild, Directive } from '@angular/core';
import * as Sentry from '@sentry/browser';
import * as am4charts from '@amcharts/amcharts4/charts';
import { Subscription } from 'rxjs';
import { DataPaceMinutesPerMile, DataPace } from '@sports-alliance/sports-lib/lib/data/data.pace';
import { ChartThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';


// Chart Themes
import animated from '@amcharts/amcharts4/themes/animated';
import material from '@amcharts/amcharts4/themes/material';
import frozen from '@amcharts/amcharts4/themes/frozen';
import dataviz from '@amcharts/amcharts4/themes/dataviz';
import dark from '@amcharts/amcharts4/themes/dark';
import amcharts from '@amcharts/amcharts4/themes/amcharts';
import amchartsdark from '@amcharts/amcharts4/themes/amchartsdark';
import moonrisekingdom from '@amcharts/amcharts4/themes/moonrisekingdom';
import spiritedaway from '@amcharts/amcharts4/themes/spiritedaway';
import kelly from '@amcharts/amcharts4/themes/kelly';
import * as am4core from '@amcharts/amcharts4/core';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';


declare function require(moduleName: string): any;

let am4ChartsTimeLineLicence;
try {
  am4ChartsTimeLineLicence = require('../../../../licenses.json').am4ChartsTimeline;
} catch (e) {
  // Noop
}

// @todo should dectate to implement on screen change
@Directive()
export abstract class ChartAbstractDirective extends LoadingAbstractDirective implements OnDestroy {
  @ViewChild('chartDiv', { static: true }) chartDiv: ElementRef;
  @ViewChild('legendDiv', { static: true }) legendDiv: ElementRef;

  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() useAnimations: boolean;


  protected chart: am4charts.PieChart | am4charts.XYChart | am4charts.RadarChart;

  protected subscriptions: Subscription[] = [];

  protected themes = {
    'material': material,
    'frozen': frozen,
    'dataviz': dataviz,
    'dark': dark,
    'amcharts': amcharts,
    'amchartsdark': amchartsdark,
    'moonrisekingdom': moonrisekingdom,
    'spiritedaway': spiritedaway,
    'kelly': kelly,
  };

  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(changeDetector);
    am4core.options.onlyShowOnViewport = false;
    am4core.options.queue = false;
    am4core.options.commercialLicense = false;
    // @todo test perf
    am4core.options.autoDispose = true;
    if (am4ChartsTimeLineLicence) {
      am4core.addLicense(am4ChartsTimeLineLicence);
    }
  }

  protected createChart(chartType?: typeof am4charts.Chart, data?: any): am4charts.Chart {

    return this.zone.runOutsideAngular(() => {
      this.setChartThemes(this.chartTheme, this.useAnimations);
      const chart = am4core.create(this.chartDiv.nativeElement, chartType || am4charts.XYChart);
      chart.preloader.disabled = true;

      // chart.pixelPerfect = true;
      // chart.colors.step = 2;
      // chart.padding(0,0,0,0)
      // chart.dataSource.updateCurrentData = true
      chart.exporting.useRetina = true;
      return chart;
    });
  }

  protected getExportingMenu(): am4core.ExportMenu {
    const exportingMenu = new am4core.ExportMenu();
    exportingMenu.align = 'right';
    exportingMenu.verticalAlign = 'bottom';
    exportingMenu.items = [{
      label: '...️',
      menu: [
        { 'type': 'png', 'label': 'PNG' }, // @todo add retina here
        { 'type': 'json', 'label': 'JSON' },
        { 'type': 'csv', 'label': 'CSV' },
        // {'type': 'xlsx', 'label': 'XLSX'},
        // {"label": "Print", "type": "print"},
      ],
    }];
    return exportingMenu;
  }

  protected setChartThemes(chartTheme: ChartThemes, useAnimations: boolean) {
    this.zone.runOutsideAngular(() => {
      am4core.unuseAllThemes();
      am4core.useTheme(this.themes[chartTheme]);
      if (useAnimations === true) {
        am4core.useTheme(animated);
      }
    });
  }

  protected destroyChart() {
    try {
      this.zone.runOutsideAngular(() => {
        am4core.unuseAllThemes();
        if (this.chart) {
          this.chart.dispose();
          // delete this.chart

        }
      });
    } catch (e) {

      // Log to Sentry
      Sentry.captureException(e);
    }
  }

  getFillColor(chart: am4charts.XYChart | am4charts.PieChart, index: number) {
    return chart.colors.getIndex(index * 2);
  }

  getFillOpacity() {
    return 0.8
  }

  getStrokeOpacity() {
    return 1;
  }

  getStrokeWidth() {
    return 0.4;
  }

  ngOnDestroy() {
    this.destroyChart();
  }

}
