import {
  ChangeDetectorRef,
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
import {UnitBasedAbstract} from '../unit-based/unit-based.abstract';
import {DataSwimPace} from 'quantified-self-lib/lib/data/data.swim-pace';
import {DataSwimPaceMaxMinutesPer100Yard} from 'quantified-self-lib/lib/data/data.swim-pace-max';
import {
  DataSpeed,
  DataSpeedFeetPerMinute,
  DataSpeedFeetPerSecond, DataSpeedKilometersPerHour,
  DataSpeedMetersPerMinute, DataSpeedMilesPerHour
} from 'quantified-self-lib/lib/data/data.speed';
import {
  DataVerticalSpeed, DataVerticalSpeedFeetPerHour, DataVerticalSpeedFeetPerMinute,
  DataVerticalSpeedFeetPerSecond, DataVerticalSpeedKilometerPerHour, DataVerticalSpeedMetersPerHour,
  DataVerticalSpeedMetersPerMinute, DataVerticalSpeedMilesPerHour
} from 'quantified-self-lib/lib/data/data.vertical-speed';
import {DataStrydDistance} from 'quantified-self-lib/lib/data/data.stryd-distance';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataLeftBalance} from 'quantified-self-lib/lib/data/data.left-balance';
import {DataRightBalance} from 'quantified-self-lib/lib/data/data.right-balance';
import {DataStrydAltitude} from 'quantified-self-lib/lib/data/data.stryd-altitude';
import {DataStrydSpeed} from 'quantified-self-lib/lib/data/data.stryd-speed';
import {DataPower} from 'quantified-self-lib/lib/data/data.power';
import {DataPowerLeft} from 'quantified-self-lib/lib/data/data.power-left';
import {DataPowerRight} from 'quantified-self-lib/lib/data/data.power-right';
import {LoadingAbstract} from '../loading/loading.abstract';
import {SummariesChartDataDateRages} from '../summaries/summaries.component';
import {ChartDataCategoryTypes} from 'quantified-self-lib/lib/users/user.dashboard.chart.settings.interface';

declare function require(moduleName: string): any;

let am4ChartsTimeLineLicence;
try {
  am4ChartsTimeLineLicence = require('../../../../licenses.json').am4ChartsTimeline;
} catch (e) {
  // Noope
}

export abstract class ChartAbstract extends LoadingAbstract implements OnDestroy {
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

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  protected getCategoryAxis(chartDataCategoryType: ChartDataCategoryTypes, chartDateDateRange?: SummariesChartDataDateRages): am4charts.CategoryAxis | am4charts.DateAxis | am4charts.Axis {
    return new am4charts.CategoryAxis()
  };

  protected createChart(chartType?: typeof am4charts.Chart): am4charts.Chart {
    this.logger.info(`Creating chart`);
    return this.zone.runOutsideAngular(() => {
      this.applyChartStylesFromUserSettings(this.userChartSettings, this.chartTheme);

      // Create a chart
      am4core.options.commercialLicense = true;
      if (am4ChartsTimeLineLicence){
        am4core.addLicense(am4ChartsTimeLineLicence);
      }
      // am4core.options.queue = true // Use this for apearing after the other (eg big data)
      const chart = am4core.create(this.chartDiv.nativeElement, chartType || am4charts.XYChart);
      chart.pixelPerfect = false;

      // chart.colors.step = 2;
      // chart.padding(0,0,0,0)
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
    this.clearChart();

  }

  protected clearChart() {
    if (this.chart) {
      this.chart.series.clear();
      this.chart.colors.reset();
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
    if ([DataAltitude.type, DataGPSAltitude.type, DataStrydAltitude.type].indexOf(name) !== -1) {
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
    if ([
      DataSpeed.type,
      DataStrydSpeed.type,
      DataSpeedMetersPerMinute.type,
      DataSpeedFeetPerMinute.type,
      DataSpeedFeetPerSecond.type,
      DataSpeedMilesPerHour.type,
      DataSpeedKilometersPerHour.type
    ].indexOf(name) !== -1) {
      return 'Speed'
    }
    if ([DataVerticalSpeed.type,
      DataVerticalSpeedFeetPerSecond.type,
      DataVerticalSpeedMetersPerMinute.type,
      DataVerticalSpeedFeetPerMinute.type,
      DataVerticalSpeedMetersPerHour.type,
      DataVerticalSpeedFeetPerHour.type,
      DataVerticalSpeedKilometerPerHour.type,
      DataVerticalSpeedMilesPerHour.type].indexOf(name) !== -1) {
      return 'Vertical Speed'
    }
    if ([DataSwimPaceMaxMinutesPer100Yard.type, DataSwimPace.type].indexOf(name) !== -1) {
      return 'Swim Pace'
    }
    if ([DataPower.type,
      DataPowerRight.type,
      DataPowerLeft.type].indexOf(name) !== -1) {
      return 'Left/Right Balance'
    }
    if ([DataLeftBalance.type,
      DataRightBalance.type].indexOf(name) !== -1) {
      return 'Left/Right Balance'
    }
    if ([DataDistance.type,
      DataStrydDistance.type].indexOf(name) !== -1) {
      return 'Distance'
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

  getShadowFilter(): am4core.DropShadowFilter{
    const shadow = new am4core.DropShadowFilter();
    shadow.dx = 1;
    shadow.dy = 1;
    return shadow
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
