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
  selector: 'app-event-card-chart',
  templateUrl: './charts.pie.component.html',
  styleUrls: ['./charts.pie.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsPieComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartDiv', {static: true}) chartDiv: ElementRef;
  @ViewChild('legendDiv', {static: true}) legendDiv: ElementRef;
  @Input() events: EventInterface[];
  @Input() user: User;
  @Input() userChartSettings: UserChartSettingsInterface;
  @Input() chartTheme: ChartThemes = ChartThemes.Material;


  public isLoading: boolean;

  private chart: am4charts.XYChart;
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
    if (!this.user || !this.events) {
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
    if (simpleChanges.events || simpleChanges.chartTheme) {
      if (!this.events) {
        return;
      }
    }
  }

  private createChart(): am4charts.XYChart {
    return this.zone.runOutsideAngular(() => {
      this.applyChartStylesFromUserSettings();

      // Create a chart
      const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);
      chart.pixelPerfect = false;
      chart.fontSize = '0.8em';
      chart.padding(15, 15, 15, 0);
      // chart.resizable = false;

      // Create a date axis
      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
      // dateAxis.skipEmptyPeriods= true;
      // dateAxis.baseInterval = {
      //   timeUnit: "second",
      //   count: 1
      // //   count: this.getStreamSamplingRateInSeconds(this.selectedActivities),
      // };
      // dateAxis.skipEmptyPeriods= true;

      // Create a value axis
      // const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
      // chart.durationFormatter.durationFormat = " mm ':' ss 'min/km'";

      // Create a Legend
      chart.legend = new am4charts.Legend();
      chart.legend.fontSize = '0.9em';
      chart.legend.parent = am4core.create(this.legendDiv.nativeElement, am4core.Container);
      chart.legend.parent.width = am4core.percent(100);
      chart.legend.parent.height = am4core.percent(100);

      chart.legend.useDefaultMarker = true;
      const marker = <am4core.RoundedRectangle>chart.legend.markers.template.children.getIndex(0);
      marker.cornerRadius(12, 12, 12, 12);
      marker.strokeWidth = 2;
      marker.strokeOpacity = 1;
      marker.stroke = am4core.color('#0a97ee');


      chart.legend.itemContainers.template.events.on('toggled', (ev) => {
        const series = <am4charts.LineSeries>ev.target.dataItem.dataContext;
        // Getting visible...
      });

      // Create a cursor
      chart.cursor = new am4charts.XYCursor();
      // chart.cursor.fullWidthLineX = true;
      // chart.cursor.fullWidthLineY = true;
      // chart.cursor.behavior = 'zoomY';

      // Add watermark
      const watermark = new am4core.Label();
      watermark.text = 'Quantified-Self.io';
      chart.plotContainer.children.push(watermark);
      watermark.align = 'right';
      watermark.valign = 'bottom';
      watermark.fontSize = '2.1em';
      watermark.opacity = 0.7;
      watermark.marginRight = 10;
      watermark.marginBottom = 5;
      watermark.zIndex = 100;
      // watermark.fontWeight = 'bold';


      // Scrollbar
      // chart.scrollbarX = new am4charts.XYChartScrollbar();

      // Add exporting options
      chart.exporting.menu = new am4core.ExportMenu();
      chart.exporting.menu.align = 'right';
      chart.exporting.menu.verticalAlign = 'bottom';
      chart.exporting.useWebFonts = true;
      chart.exporting.menu.items = [{
        label: '...️',
        menu: [
          {'type': 'png', 'label': 'PNG', options: {useRetina: true}},
          {'type': 'json', 'label': 'JSON'},
          {'type': 'csv', 'label': 'CSV'},
          {'type': 'xlsx', 'label': 'XLSX'},
          // {"label": "Print", "type": "print"},
        ],
      }];

      chart.exporting.extraSprites.push({
        'sprite': chart.legend.parent,
        'position': 'bottom',
        'marginTop': 20
      });

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
        ev.target.legend.svgContainer.htmlElement.style.height = this.chart.legend.contentHeight + 'px'; // @todo test
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
    this.chart.yAxes.clear();
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
