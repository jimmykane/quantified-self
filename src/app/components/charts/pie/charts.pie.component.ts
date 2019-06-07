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
import * as Raven from 'raven-js';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {User} from 'quantified-self-lib/lib/users/user';
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
import {UserSettingsService} from '../../../services/app.user.settings.service';
import {ThemeService} from '../../../services/app.theme.service';
import {EventColorService} from '../../../services/color/app.event.color.service';
import {EventService} from '../../../services/app.event.service';

@Component({
  selector: 'app-pie-chart',
  templateUrl: './charts.pie.component.html',
  styleUrls: ['./charts.pie.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsPieComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartDiv', {static: true}) chartDiv: ElementRef;
  @Input() data: any;
  @Input() userChartSettings: UserChartSettingsInterface;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;


  public isLoading: boolean;
  private dataSelected: any;

  private chart: am4charts.PieChart;
  private logger = Log.create('EventCardChartComponent');

  private themes = {
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

  constructor(private  changeDetector: ChangeDetectorRef,
              private zone: NgZone,
              private eventService: EventService,
              private userSettingsService: UserSettingsService,
              private themeService: ThemeService,
              private eventColorService: EventColorService) {
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
    if (!this.data) {
      throw new Error('Component needs events and users');
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
    }

    // Beyond here component is visible and data is not bound //

    // 3. If something changed then do the needed
    if (simpleChanges.data || simpleChanges.chartTheme) {
      if (!this.data) {
        return;
      }
    }
  }

  private createChart(): am4charts.PieChart {
    return this.zone.runOutsideAngular(() => {
      this.applyChartStylesFromUserSettings();

      // Create a chart
      const  chart = am4core.create(this.chartDiv.nativeElement, am4charts.PieChart);

      const pieSeries = chart.series.push(new am4charts.PieSeries());
      pieSeries.dataFields.value = "percent";
      pieSeries.dataFields.category = "type";
      // pieSeries.slices.template.propertyFields.fill = "color";
      pieSeries.slices.template.propertyFields.isActive = "pulled";
      pieSeries.slices.template.strokeWidth = 0;


      //

      pieSeries.slices.template.events.on('hit', (event) => {
        if (event.target.dataItem.dataContext['id'] !== undefined) {
          this.dataSelected = event.target.dataItem.dataContext['id'];
        } else {
          this.dataSelected  = null;
        }
        this.chart.data = this.generateChartData(this.data);
      });


      chart.data = this.generateChartData(this.data);
      // chart.exporting.menu = new am4core.ExportMenu();
      // chart.exporting.menu.align = 'right';
      // chart.exporting.menu.verticalAlign = 'bottom';
      // chart.exporting.useWebFonts = true;
      // chart.exporting.menu.items = [{
      //   label: '...️',
      //   menu: [
      //     {'type': 'png', 'label': 'PNG', options: {useRetina: true}},
      //     {'type': 'json', 'label': 'JSON'},
      //     {'type': 'csv', 'label': 'CSV'},
      //     {'type': 'xlsx', 'label': 'XLSX'},
      //     // {"label": "Print", "type": "print"},
      //   ],
      // }];


      //
      // Disable the preloader
      chart.preloader.disabled = true;

      // Attach events
      chart.events.on('validated', (ev) => {
        this.logger.info('validated');
        if (ev.target.data.length) {
          this.loaded();
        }
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
        // ev.target.legend.svgContainer.htmlElement.style.height = this.chart.legend.contentHeight + 'px'; // @todo test
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
            percent: data[i].subs[x].percent,
            color: data[i].color,
            pulled: true
          });
        }
      } else {
        chartData.push({
          type: data[i].type,
          percent: data[i].percent,
          color: data[i].color,
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



  private loading() {
    this.isLoading = true;
    this.changeDetector.detectChanges();
  }

  private loaded() {
    this.isLoading = false;
    this.changeDetector.detectChanges();
  }

  private unsubscribeAndClearChart() {
    this.unSubscribeFromAll();
    this.chart.series.clear();
    this.chart.colors.reset();
  }

  private unSubscribeFromAll() {
  }

  private destroyChart() {
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
      Raven.captureException(e);
    }
  }

  ngOnDestroy() {
    this.destroyChart();
    this.unSubscribeFromAll();
  }
}
