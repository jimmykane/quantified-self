import {
  ElementRef,
  Input,
  NgZone,
  OnDestroy,
  ViewChild
} from '@angular/core';
import * as Sentry from '@sentry/browser';
import * as am4charts from '@amcharts/amcharts4/charts';
import {Log} from 'ng2-logger/browser';
import {Subscription} from 'rxjs';
import {DataPaceMinutesPerMile, DataPace} from 'quantified-self-lib/lib/data/data.pace';
import {ChartThemes, UserChartSettingsInterface} from 'quantified-self-lib/lib/users/user.chart.settings.interface';


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
import {DataAltitude} from 'quantified-self-lib/lib/data/data.altitude';
import {DataGPSAltitude} from 'quantified-self-lib/lib/data/data.altitude-gps';
import {DataEHPE} from 'quantified-self-lib/lib/data/data.ehpe';
import {DataEVPE} from 'quantified-self-lib/lib/data/data.evpe';
import {DataAbsolutePressure} from 'quantified-self-lib/lib/data/data.absolute-pressure';
import {DataSeaLevelPressure} from 'quantified-self-lib/lib/data/data.sea-level-pressure';
import {DataElevation} from 'quantified-self-lib/lib/data/data.elevation';
import {UnitBasedAbstract} from '../unit-based/unit-based.abstract';
import {DataSwimPace} from 'quantified-self-lib/lib/data/data.swim-pace';
import {DataSwimPaceMaxMinutesPer100Yard} from 'quantified-self-lib/lib/data/data.swim-pace-max';

export abstract class ChartAbstract extends UnitBasedAbstract implements OnDestroy {
  @ViewChild('chartDiv', {static: true}) chartDiv: ElementRef;
  @ViewChild('legendDiv', {static: true}) legendDiv: ElementRef;

  @Input() userChartSettings: UserChartSettingsInterface;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;

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
    super();
  }

  getCategoryAxis(): am4charts.CategoryAxis {
    return new am4charts.CategoryAxis();
  }

  protected createChart(chartType: typeof am4charts.Chart): am4charts.Chart {
    return this.zone.runOutsideAngular(() => {
      this.applyChartStylesFromUserSettings(this.userChartSettings, this.chartTheme);

      // Create a chart
      am4core.options.commercialLicense = true;
      // am4core.options.queue = true // Use this for apearing after the other (eg big data)
      const chart = am4core.create(this.chartDiv.nativeElement, chartType);
      chart.pixelPerfect = false;
      // chart.dataSource.updateCurrentData = true
      return chart;
    });
  }

  protected attachEventListenersOnChart(chart: am4charts.PieChart | am4charts.XYChart) {
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
      if (this.chart instanceof am4charts.XYChart) {
        this.chart.yAxes.clear();
      }
    }
  }

  private unSubscribeFromAll() {
    this.getSubscriptions().forEach(subscription => subscription.unsubscribe());
    this.logger.info(`Unsubscribed from ${this.getSubscriptions().length} subscriptions`);
  }

  protected getSubscriptions(): Subscription[] {
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

  protected getYAxisForSeries(streamType: string) {
    let yAxis: am4charts.ValueAxis | am4charts.DurationAxis;
    if ([DataPace.type, DataPaceMinutesPerMile.type, DataSwimPace.type, DataSwimPaceMaxMinutesPer100Yard.type].indexOf(streamType) !== -1) {
      yAxis = new am4charts.DurationAxis()
    } else {
      yAxis = new am4charts.ValueAxis();
    }
    return yAxis;
  }

  protected hideSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = true;
    // series.yAxis.renderer.grid.template.disabled = true;
  }

  protected showSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = false;
    // series.yAxis.renderer.grid.template.disabled = false;
  }

  protected getVisibleSeriesWithSameYAxis(series: am4charts.XYSeries): am4charts.XYSeries[] {
    return this.getVisibleSeries(series.chart).filter(serie => serie.id !== series.id).filter(serie => serie.name === series.name);
  }

  protected getVisibleSeries(chart: am4charts.XYChart): am4charts.XYSeries[] {
    return chart.series.values
      .filter(series => !series.hidden);
  }

  protected hideSeries(series: am4charts.XYSeries) {
    // series.disabled = true;
    series.hidden = true;
    // series.hide();
    if (!this.getVisibleSeriesWithSameYAxis(series).length) {
      this.hideSeriesYAxis(series)
    }
  }

  protected showSeries(series: am4charts.XYSeries) {
    // series.disabled = false;
    series.hidden = false;
    // series.show();
    this.showSeriesYAxis(series);
  }

  // This helps to goup series vy providing the same name (type) for things that should have the same axis
  protected getSeriesName(name: string) {
    if ([DataAltitude.type, DataGPSAltitude.type, DataElevation.type].indexOf(name) !== -1) {
      return DataAltitude.type;
    }
    if ([DataEHPE.type, DataEVPE.type].indexOf(name) !== -1) {
      return 'Positional Error'
    }
    if ([DataAbsolutePressure.type, DataSeaLevelPressure.type].indexOf(name) !== -1) {
      return 'Pressure'
    }
    if ([DataPace.type, DataPaceMinutesPerMile.type].indexOf(name) !== -1) {
      return 'Pace'
    }
    if ([ DataSwimPaceMaxMinutesPer100Yard.type, DataSwimPace.type].indexOf(name) !== -1) {
      return 'Swim Pace'
    }
    return name;
  }

  protected applyChartStylesFromUserSettings(userChartSettings: UserChartSettingsInterface, chartTheme: ChartThemes) {
    this.zone.runOutsideAngular(() => {
      am4core.unuseAllThemes();
      am4core.useTheme(this.themes[chartTheme]);
      if (userChartSettings && userChartSettings.useAnimations) {
        am4core.useTheme(animated);
      }
    });
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

  getTextInitials(text: string) {
    return `${text.split(' ').map(x => x.slice(0, 1).toUpperCase()).join('. ')}.`
  }

  getTextDependingOnSizeToSaveHorizontalSpace(text: string) {
    if (text.length > 15) {
      return `${text.slice(0, 15)}...`
    }
  }

  ngOnDestroy() {
    this.destroyChart();
    this.unSubscribeFromAll();
  }

}
