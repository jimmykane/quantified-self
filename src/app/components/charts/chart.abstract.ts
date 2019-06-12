import {AfterViewInit, ChangeDetectorRef, NgZone, OnChanges, OnDestroy, OnInit} from '@angular/core';
import * as Sentry from '@sentry/browser';
import * as am4charts from '@amcharts/amcharts4/charts';
import {Log} from 'ng2-logger/browser';
import {Subscription} from 'rxjs';

import material from '@amcharts/amcharts4/themes/material';
import frozen from '@amcharts/amcharts4/themes/frozen';
import dataviz from '@amcharts/amcharts4/themes/dataviz';
import dark from '@amcharts/amcharts4/themes/dark';
import amcharts from '@amcharts/amcharts4/themes/amcharts';
import amchartsdark from '@amcharts/amcharts4/themes/amchartsdark';
import moonrisekingdom from '@amcharts/amcharts4/themes/moonrisekingdom';
import spiritedaway from '@amcharts/amcharts4/themes/spiritedaway';
import kelly from '@amcharts/amcharts4/themes/kelly';
import * as am4core from "@amcharts/amcharts4/core";

export abstract class ChartAbstract implements OnDestroy {
  protected chart: am4charts.PieChart | am4charts.XYChart;
  protected logger = Log.create('ChartAbstract');
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

  constructor(protected zone: NgZone) {
  }


  protected attachEventListenersOnChart(chart: am4charts.PieChart | am4charts.XYChart){
    chart.events.on('validated', (ev) => {
      this.logger.info('validated');
    });

    chart.events.on('globalscalechanged', (ev) => {
      this.logger.info('globalscalechanged');
    });

    chart.events.on('dataitemsvalidated', (ev) => {
      this.logger.info('dataitemsvalidated');
    });


    chart.events.on('datavalidated', (ev) => {
      this.logger.info('datavalidated');

    });

    chart.events.on('datarangechanged', (ev) => {
      this.logger.info('datarangechanged');
    });

    chart.events.on('ready', (ev) => {
      this.logger.info('ready');
    });


    chart.events.on('shown', (ev) => {
      this.logger.info('shown');
    });

    chart.events.on('transformed', (ev) => {
      this.logger.info('transformed');
    });

    chart.events.on('maxsizechanged', (ev) => {
      this.logger.info('maxsizechanged');
    });

    chart.events.on('visibilitychanged', (ev) => {
      this.logger.info('visibilitychanged');
    });

    chart.events.on('hidden', (ev) => {
      this.logger.info('hidden');
    });
    chart.events.on('shown', (ev) => {
      this.logger.info('shown');
    });

    chart.events.on('inited', (ev) => {
      this.logger.info('inited');
    });
  }

  protected unsubscribeAndClearChart() {
    this.unSubscribeFromAll();
    if (this.chart) {
      this.chart.series.clear();
      this.chart.colors.reset();
      if (this.chart instanceof am4charts.XYChart)  {
        this.chart.yAxes.clear();
      }
    }
  }

  private unSubscribeFromAll() {
    this.getSubscriptions().forEach(subscription => subscription.unsubscribe());
    this.logger.info(`Unsubscribed from ${this.getSubscriptions().length} subscriptions`);
  }

  protected getSubscriptions(): Subscription[]{
    return this.subscriptions;
  }

  protected getExportingMenu(): am4core.ExportMenu {
    const exportingMenu = new am4core.ExportMenu();
    exportingMenu.align = 'right';
    exportingMenu.verticalAlign = 'bottom';
    exportingMenu.items = [{
      label: '...️',
      menu: [
        {'type': 'png', 'label': 'PNG', options: {useRetina: true}},
        {'type': 'json', 'label': 'JSON'},
        {'type': 'csv', 'label': 'CSV'},
        {'type': 'xlsx', 'label': 'XLSX'},
        // {"label": "Print", "type": "print"},
      ],
    }];
    return exportingMenu;
  }

  protected destroyChart() {
    try {
      this.zone.runOutsideAngular(() => {
        if (this.chart) {
          this.chart.dispose();
          delete this.chart
        }
      });
    } catch (e) {
      this.logger.error('Could not destroy chart');
      // Log to Sentry
      Sentry.captureException(e);
    }
  }

  ngOnDestroy() {
    this.destroyChart();
    this.unSubscribeFromAll();
  }
}
