import { ChangeDetectorRef, ElementRef, Input, NgZone, OnDestroy, ViewChild, Directive } from '@angular/core';
import * as Sentry from '@sentry/browser';
import type * as am4charts from '@amcharts/amcharts4/charts';
import { Subscription } from 'rxjs';
import { DataPaceMinutesPerMile, DataPace } from '@sports-alliance/sports-lib/lib/data/data.pace';
import { ChartThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.chart.settings.interface';


// Chart Themes - remove static imports
// import animated from '@amcharts/amcharts4/themes/animated';
// ...

import type * as am4core from '@amcharts/amcharts4/core';
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

  // Remove static themes map
  // protected themes = { ... };

  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  // Helper to load libraries dynamically
  protected async loadAmCharts() {
    const [am4core, am4charts] = await Promise.all([
      import('@amcharts/amcharts4/core'),
      import('@amcharts/amcharts4/charts')
    ]);
    return { am4core, am4charts };
  }

  protected async createChart(chartType?: any, data?: any): Promise<am4charts.Chart> {

    const { am4core, am4charts } = await this.loadAmCharts();

    // Set options after load
    am4core.options.onlyShowOnViewport = false;
    am4core.options.queue = false;
    am4core.options.commercialLicense = true;
    am4core.options.autoDispose = true;
    if (am4ChartsTimeLineLicence) {
      am4core.addLicense(am4ChartsTimeLineLicence);
    }

    return this.zone.runOutsideAngular(async () => {
      await this.setChartThemes(this.chartTheme, this.useAnimations, am4core);
      const chart = <am4charts.Chart>am4core.create(this.chartDiv.nativeElement, chartType || am4charts.XYChart);
      chart.preloader.disabled = true;
      chart.exporting.useRetina = true;
      return chart;
    });
  }

  // async getExportingMenu(): Promise<am4core.ExportMenu> { ... } // If needed

  protected async setChartThemes(chartTheme: ChartThemes, useAnimations: boolean, am4core: typeof import('@amcharts/amcharts4/core')) {
    am4core.unuseAllThemes();

    let themeModule;
    switch (chartTheme) {
      case 'material': themeModule = await import('@amcharts/amcharts4/themes/material'); break;
      case 'frozen': themeModule = await import('@amcharts/amcharts4/themes/frozen'); break;
      case 'dataviz': themeModule = await import('@amcharts/amcharts4/themes/dataviz'); break;
      case 'dark': themeModule = await import('@amcharts/amcharts4/themes/dark'); break;
      case 'amcharts': themeModule = await import('@amcharts/amcharts4/themes/amcharts'); break;
      case 'amchartsdark': themeModule = await import('@amcharts/amcharts4/themes/amchartsdark'); break;
      case 'moonrisekingdom': themeModule = await import('@amcharts/amcharts4/themes/moonrisekingdom'); break;
      case 'spiritedaway': themeModule = await import('@amcharts/amcharts4/themes/spiritedaway'); break;
      case 'kelly': themeModule = await import('@amcharts/amcharts4/themes/kelly'); break;
      default: themeModule = await import('@amcharts/amcharts4/themes/material'); break;
    }

    am4core.useTheme(themeModule.default);

    if (useAnimations === true) {
      const animated = await import('@amcharts/amcharts4/themes/animated');
      am4core.useTheme(animated.default);
    }
  }

  protected destroyChart() {
    try {
      this.zone.runOutsideAngular(async () => {
        // We need core to unuse themes, but strictly we just need to dispose the chart object which we have
        if (this.chart) {
          // If we need to unuse themes we might need to load am4core again or store reference. 
          // Often just disposing chart is enough.
          // But to be safe let's load core if we want to unuseAllThemes
          const am4core = await import('@amcharts/amcharts4/core');
          am4core.unuseAllThemes();
          this.chart.dispose();
        }
      });
    } catch (e) {
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
