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
import {EventColorService} from '../../../../services/color/app.event.color.service';
import * as Raven from 'raven-js';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {DataHeartRate} from 'quantified-self-lib/lib/data/data.heart-rate';
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {combineLatest, Subscription} from 'rxjs';
import {EventService} from '../../../../services/app.event.service';
import {DataAltitude} from 'quantified-self-lib/lib/data/data.altitude';
import {map} from 'rxjs/operators';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {User} from 'quantified-self-lib/lib/users/user';
import {isNumber} from "quantified-self-lib/lib/events/utilities/helpers";
import {DataPace} from "quantified-self-lib/lib/data/data.pace";
import {UserChartSettingsInterface} from "quantified-self-lib/lib/users/user.chart.settings.interface";


import animated from "@amcharts/amcharts4/themes/animated";

import material from "@amcharts/amcharts4/themes/material";
import frozen from "@amcharts/amcharts4/themes/frozen";
import dataviz from "@amcharts/amcharts4/themes/dataviz";
import dark from "@amcharts/amcharts4/themes/dark";
import amcharts from "@amcharts/amcharts4/themes/amcharts";
import amchartsdark from "@amcharts/amcharts4/themes/amchartsdark";
import moonrisekingdom from "@amcharts/amcharts4/themes/moonrisekingdom";
import spiritedaway from "@amcharts/amcharts4/themes/spiritedaway";
import kelly from "@amcharts/amcharts4/themes/kelly";

@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCardChartNewComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartDiv') chartDiv: ElementRef;
  @ViewChild('legendDiv') legendDiv: ElementRef;
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() userChartSettings: UserChartSettingsInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible: boolean;
  @Input() showAllData: boolean;

  public isLoading: boolean;

  private streamsSubscription: Subscription;
  private chart: am4charts.XYChart;
  private logger = Log.create('EventCardChartComponent');

  private renderPerSeries = true;

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
              private eventColorService: EventColorService) {
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
    if (!this.user || !this.event) {
      throw 'Component needs events and users';
    }
  }

  async ngOnChanges(simpleChanges) {
    // 1. If there is no chart create
    if (!this.chart) {
      this.chart = this.createChart();
    }

    // WARNING DO NOT ALLOW READS IF NOT VISIBLE! //

    // 2. If not visible and no data is bound do nothing
    if (!this.isVisible && (!this.streamsSubscription || this.streamsSubscription.closed)) {
      return;
    }

    // Beyond here component is visible and data is not bound //

    // 3. If something changed then do the needed
    if (simpleChanges.event || simpleChanges.selectedActivities || simpleChanges.showAllData || simpleChanges.userChartSettings) {
      if (!this.event || !this.selectedActivities.length) {
        this.unsubscribeAndClearChart();
        return;
      }
      this.unsubscribeAndClearChart();
      this.processChanges();
    }

    // 4. If nothing has changed but we do not have data binding then bind
    if (!this.streamsSubscription || this.streamsSubscription.closed) {
      this.processChanges();
    }
  }

  private processChanges() {
    this.loading();
    this.streamsSubscription = combineLatest(this.selectedActivities.map((activity) => {
      const allOrSomeSubscription = this.eventService.getStreamsByTypes(this.user, this.event.getID(), activity.getID(),
        this.determineDataToUse(),
      );
      return allOrSomeSubscription.pipe(map((streams) => {
        if (!streams.length) {
          return [];
        }
        // debugger;
        return streams.map((stream) => {
          return this.createOrUpdateChartSeries(activity, stream);
        });
      }))
    })).pipe(map((seriesArrayOfArrays) => {
      // Format flatten the arrays as they come in [[], []]
      return seriesArrayOfArrays.reduce((accu: [], item: []): am4charts.XYSeries[] => accu.concat(item), [])
    })).subscribe((series: am4charts.LineSeries[]) => {
      if (!this.renderPerSeries) {
        this.addDataToChart(this.getDataFromSeriesDummyData(series));
      } else {
        series.forEach((series) => this.addDataToSeries(series, series.dummyData));
      }

      this.logger.info(`Data Injected`);
    });
  }

  private createChart(): am4charts.XYChart {
    return this.zone.runOutsideAngular(() => {
      this.applyChartStylesFromUserSettings();

      // Create a chart
      const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);
      chart.pixelPerfect = false;
      chart.fontSize = '0.9em';
      chart.padding(15, 0, 15, 0);
      // chart.resizable = false;

      // Create a date axis
      const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
      // dateAxis.skipEmptyPeriods= true;
      dateAxis.title.text = "Time";
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
      const legendContainer = am4core.create(this.legendDiv.nativeElement, am4core.Container);
      legendContainer.width = am4core.percent(100);
      legendContainer.height = am4core.percent(100);
      // legendContainer.padding(0, 0,150,0);
      // chart.legend.useDefaultMarker = true;
      // const marker = <am4core.RoundedRectangle>chart.legend.markers.template.children.getIndex(0);
      // marker.cornerRadius(12, 12, 12, 12);
      // marker.strokeWidth = 2;
      // marker.strokeOpacity = 1;
      // marker.stroke = am4core.color("#ccc");
      chart.legend.parent = legendContainer;

      chart.legend.itemContainers.template.events.on("hit", (ev) => {
        // debugger;
        const series = <am4charts.LineSeries>ev.target.dataItem.dataContext;
        // Getting visible...
        if (!series.isHidden) {
          this.showSeries(series)
        } else {
          this.hideSeries(series)
        }
      });

      // Create a cursor
      chart.cursor = new am4charts.XYCursor();
      // chart.cursor.fullWidthLineX = true;
      // chart.cursor.fullWidthLineY = true;
      // chart.cursor.behavior = 'zoomY';

      // Add watermark
      const watermark = new am4core.Label();
      watermark.text = "Quantified-Self.io";
      chart.plotContainer.children.push(watermark);
      watermark.align = "right";
      watermark.valign = "bottom";
      watermark.fontSize = '2em';
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
      chart.exporting.useWebFonts = false;
      chart.exporting.menu.items = [{
        label: "...️",
        menu: [
          {"type": "png", "label": "PNG", options: {useRetina: true}},
          {"type": "csv", "label": "CSV"},
          {"label": "Print", "type": "print"},
        ],
      }];

      // Disable the preloader
      chart.preloader.disabled = true;

      // Attach events
      chart.events.on('validated', (ev) => {
        this.logger.info('validated');
        if (this.chart.data.length) {
          this.loaded();
        }
      });

      chart.events.on('globalscalechanged', (ev) => {
        this.logger.info('globalscalechanged');
        // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      });

      chart.events.on('dataitemsvalidated', (ev) => {
        this.logger.info('dataitemsvalidated');
        // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      });


      chart.events.on('datavalidated', (ev) => {
        this.logger.info('datavalidated');
        // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      });

      chart.events.on('datarangechanged', (ev) => {
        this.logger.info('datarangechanged');
        // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      });

      chart.events.on('ready', (ev) => {
        this.logger.info('ready');
      });


      chart.events.on('shown', (ev) => {
        this.logger.info('shown');
        // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      });

      chart.events.on('transformed', (ev) => {
        this.logger.info('transformed');
        // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      });

      chart.events.on('maxsizechanged', (ev) => {
        this.logger.info('maxsizechanged');
        // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
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

  private createOrUpdateChartSeries(activity: ActivityInterface, stream: StreamInterface): am4charts.XYSeries {
    let series = this.chart.series.values.find(series => series.id === `${activity.getID()}${stream.type}`);
    // If there is already a series with this id only data update should be done
    if (series) {
      series.dummyData = this.convertStreamDataToSeriesData(activity, stream);
      return series
    }

    let yAxis: am4charts.Axis;

    // Check if we have a series with the same name aka type
    const sameTypeSeries = this.chart.series.values.find((serie) => serie.name === stream.type);
    if (!sameTypeSeries) {
      yAxis = this.chart.yAxes.push(this.getYAxisForSeries(stream.type));
    } else {
      // Share
      yAxis = sameTypeSeries.yAxis;
    }

    // Then create a series
    series = this.chart.series.push(new am4charts.LineSeries());
    this.chart.series.sort((left, right) => {
      return left.name > right.name ? 1 : 0;
    });
    // Set the axis
    series.yAxis = yAxis;
    // Add the tooltips
    // yAxis.adapter.add("getTooltipText", function (text, target, key) {
    //   return `${text} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit} `;
    // });

    // Setup the series
    series.id = `${activity.getID()}${stream.type}`;
    series.name = `${stream.type}`;

    // series.adapter.add("tooltipText", function (text, target, key) {
    //   debugger;
    //   return ">>> " + text + " <<<";
    // });
    if (stream.type === DataPace.type) {
      series.tooltipText = `${activity.creator.name}  ${stream.type} {valueY.formatDuration()} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
    } else {
      series.tooltipText = `${activity.creator.name}  ${stream.type} {valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;

    }
    series.legendSettings.labelText = `${stream.type} [${am4core.color(this.eventColorService.getActivityColor(this.event, activity)).toString()}]${activity.creator.name}[/]`;
    // series.legendSettings.itemValueText = `{valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;

    // Search if there is any other series with the same color we would like to have
    const found = this.chart.series.values.find((series) => {
      return series.stroke.toString() === am4core.color(this.eventColorService.getActivityColor(this.event, activity)).toString();
    });
    // IF there is no other series with the same color then add the activity color
    if (!found) {
      series.stroke = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
      series.fill = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
    }

    series.strokeWidth = 1;
    series.fillOpacity = 0.15;
    // series.defaultState.transitionDuration = 0;

    if (!this.renderPerSeries) {
      series.dataFields.valueY = series.id;
      series.dataFields.dateX = "date";

    } else {
      series.dataFields.valueY = 'value';
      series.dataFields.dateX = "time";
    }

    series.interactionsEnabled = false;

    if (([DataHeartRate.type, DataAltitude.type].indexOf(stream.type) === -1) || this.getVisibleSeries(this.chart).length > (this.selectedActivities.length * 2)) {
      this.hideSeries(series);
    }

    // Attach events
    series.events.on('validated', (ev) => {
      this.logger.info('Series validated');
      this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      // if (this.chart.series.getIndex(0) && this.chart.series.getIndex(0).data && this.chart.series.getIndex(0).dummyData.length) {
      this.loaded();
      // }
    });

    series.events.on('ready', (ev) => {
      this.logger.info('Series ready');
    });

    // Finally set the data and return
    series.dummyData = this.convertStreamDataToSeriesData(activity, stream);
    return series;
  }

  private convertStreamDataToSeriesData(activity: ActivityInterface, stream: StreamInterface): any {
    const samplingRate = this.getStreamSamplingRateInSeconds(stream);
    this.logger.info(`Stream data for ${stream.type} length before sampling ${stream.data.length}`);
    const data = stream.data.reduce((dataArray: { time: number, value: number | string | boolean }[], streamData, index) => {
      if (!isNumber(streamData)) {
        return dataArray
      }
      dataArray.push({
        time: activity.startDate.getTime() + (index * 1000),
        value: streamData, // Display value can be string this needs to be corrected
      });
      return dataArray
    }, [])
      .filter((data, index) => (index % samplingRate) === 0);
    this.logger.info(`Stream data for ${stream.type} after sampling and filtering ${data.length}`);
    return data;
  }

  private getStreamSamplingRateInSeconds(stream: StreamInterface): number {
    const numberOfSamples = stream.getNumericData().length;
    let samplingRate = 1;
    const hoursToKeep1sSamplingRateForAllActivities = 2; // 2 hours
    const numberOfSamplesToHours = numberOfSamples / 3600;
    samplingRate = Math.ceil((numberOfSamplesToHours * 3 * this.selectedActivities.length) / hoursToKeep1sSamplingRateForAllActivities)
    this.logger.info(`${numberOfSamples} for ${stream.type} are about ${numberOfSamplesToHours} hours. Sampling rate is ${samplingRate}`);
    return samplingRate;
  }

  private addDataToChart(data: any) {
    this.zone.runOutsideAngular(() => {
      this.chart.data = data;
    });
  }

  private addDataToSeries(series: am4charts.LineSeries, data: any) {
    this.zone.runOutsideAngular(() => {
      series.data = data;
    });
  }

  private getDataFromSeriesDummyData(series: am4charts.LineSeries[]): any {
    let data = series.reduce((data, series) => {
      // debugger;
      series.dummyData.forEach((dataItem: { time: number, value: number | string | boolean }) => {
        // debugger;
        if (!data[dataItem.time]) {
          data[dataItem.time] = {date: dataItem.time}
        }
        data[dataItem.time][series.id] = dataItem.value;
      });
      return data;
    }, {});
    return Object.keys(data).map(key => data[key]).sort((dataItemA: any, dataItemB: any) => {
      return +dataItemA.date - +dataItemB.date;
    })
  }

  private determineDataToUse(): string[] {
    let dataTypes = DynamicDataLoader.basicDataTypes;
    // Set the datatypes to show if all is selected
    if (this.showAllData) {
      dataTypes = DynamicDataLoader.allDataTypes;
    }
    // If there is a change in the chart settings and its valid update settings
    if (this.userChartSettings && !this.showAllData) {
      // Set the datatypes to use
      dataTypes = Object.keys(this.userChartSettings.dataTypeSettings).reduce((dataTypesToUse, dataTypeSettingsKey) => {
        if (this.userChartSettings.dataTypeSettings[dataTypeSettingsKey].enabled === true) {
          dataTypesToUse.push(dataTypeSettingsKey);
        }
        return dataTypesToUse;
      }, []);
    }
    return dataTypes
  }

  private applyChartStylesFromUserSettings() {
    this.zone.runOutsideAngular(() => {
      am4core.unuseAllThemes();
      // If no default settings then go on an apply ze defaults
      if (!this.userChartSettings) {
        am4core.useTheme(material);
        return;
      }

      if (this.userChartSettings.useAnimations) {
        am4core.useTheme(animated);
      }
      am4core.useTheme(this.themes[this.userChartSettings.theme]);
    });
  }

  private getYAxisForSeries(streamType: string) {
    let yAxis: am4charts.ValueAxis | am4charts.DurationAxis;
    if (streamType === DataPace.type) {
      yAxis = new am4charts.DurationAxis()
    } else {
      yAxis = new am4charts.ValueAxis();
    }
    return yAxis;
  }

  private hideSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = true;
    series.yAxis.hidden = true;
    series.yAxis.renderer.grid.template.disabled = true;
  }

  private showSeriesYAxis(series: am4charts.XYSeries) {
    series.yAxis.disabled = false;
    series.yAxis.hidden = false;
    series.yAxis.renderer.grid.template.disabled = false;
  }

  private getVisibleSeriesWithSameYAxis(series: am4charts.XYSeries): am4charts.XYSeries[] {
    return this.getVisibleSeries(series.chart).filter(serie => serie.id !== series.id).filter(serie => serie.name === series.name);
  }

  private getVisibleSeries(chart: am4charts.XYChart): am4charts.XYSeries[] {
    return chart.series.values
      .filter(series => !series.isHidden);
  }

  private hideSeries(series: am4charts.XYSeries) {
    series.hidden = true;
    series.hide();
    if (!this.getVisibleSeriesWithSameYAxis(series).length) {
      this.hideSeriesYAxis(series)
    }
  }

  private showSeries(series: am4charts.XYSeries) {
    series.hidden = false;
    series.show();
    this.showSeriesYAxis(series);
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
    if (this.streamsSubscription) {
      this.streamsSubscription.unsubscribe();
    }
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
