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
import {DataAbsolutePressure} from 'quantified-self-lib/lib/data/data.absolute-pressure';
import {DataSeaLevelPressure} from 'quantified-self-lib/lib/data/data.sea-level-pressure';
import {DataCadence} from 'quantified-self-lib/lib/data/data.cadence';
import {DataPower} from 'quantified-self-lib/lib/data/data.power';
import {DataGPSAltitude} from 'quantified-self-lib/lib/data/data.altitude-gps';
import {DataSpeed} from 'quantified-self-lib/lib/data/data.speed';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DataTemperature} from 'quantified-self-lib/lib/data/data.temperature';
import {DataSatellite5BestSNR} from 'quantified-self-lib/lib/data/data.satellite-5-best-snr';
import {DataNumberOfSatellites} from 'quantified-self-lib/lib/data/data.number-of-satellites';
import {DataEVPE} from 'quantified-self-lib/lib/data/data.evpe';
import {DataEHPE} from 'quantified-self-lib/lib/data/data.ehpe';
import {DataVO2Max} from 'quantified-self-lib/lib/data/data.vo2-max';
import {DataPeakTrainingEffect} from 'quantified-self-lib/lib/data/data.peak-training-effect';
import {DataEPOC} from 'quantified-self-lib/lib/data/data.epoc';
import {DataEnergy} from 'quantified-self-lib/lib/data/data.energy';
import {DataNumberOfSamples} from 'quantified-self-lib/lib/data/data-number-of.samples';
import {DataBatteryCharge} from 'quantified-self-lib/lib/data/data.battery-charge';
import {DataBatteryCurrent} from 'quantified-self-lib/lib/data/data.battery-current';
import {DataBatteryVoltage} from 'quantified-self-lib/lib/data/data.battery-voltage';
import {DataBatteryConsumption} from 'quantified-self-lib/lib/data/data.battery-consumption';
import {DataFormPower} from 'quantified-self-lib/lib/data/data.form-power';
import {DataLegStiffness} from 'quantified-self-lib/lib/data/data.leg-stiffness';
import {DataVerticalOscillation} from 'quantified-self-lib/lib/data/data.vertical-oscillation';
import {DataTotalTrainingEffect} from 'quantified-self-lib/lib/data/data.total-training-effect';
import {User} from 'quantified-self-lib/lib/users/user';
import {isNumber} from "quantified-self-lib/lib/events/utilities/helpers";
import {UserChartSettingsInterface} from "quantified-self-lib/lib/users/user.chart.settings.interface";


// import am4themes_animated from "@amcharts/amcharts4/themes/animated";
import am4themes_material from "@amcharts/amcharts4/themes/material";
// import am4themes_frozen from "@amcharts/amcharts4/themes/frozen";
// import am4themes_dataviz from "@amcharts/amcharts4/themes/dataviz";
// import am4themes_dark from "@amcharts/amcharts4/themes/dark";
// import am4themes_kelly from "@amcharts/amcharts4/themes/kelly";
// import am4themes_am_dark from "@amcharts/amcharts4/themes/amchartsdark";
// import am4themes_am from "@amcharts/amcharts4/themes/amcharts";
am4core.useTheme(am4themes_material);
// am4core.useTheme(am4themes_animated);
// am4core.useTheme(am4themes_dataviz);
// am4core.useTheme(am4themes_kelly);

// am4core.useTheme(am4themes_am);

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
  @Input() dataTypesToUse = [];
  @Input() isVisible: boolean;
  @Input() showAllStats: boolean;
  @Input() showOnlyOneYAxis: boolean;

  public isLoading: boolean;

  private streamsSubscription: Subscription;
  private chart: am4charts.XYChart;
  private logger = Log.create('EventCardChartComponent');

  private basicData = [
    DataHeartRate.type,
    DataAltitude.type,
    DataCadence.type,
    DataPower.type,
    // DataPace.type,
    DataSpeed.type,
    DataVO2Max.type,
  ];

  private allData = this.basicData.concat([
    // DataGPSAltitude.type,
    DataTemperature.type,
    DataSeaLevelPressure.type,
    DataSatellite5BestSNR.type,
    DataNumberOfSatellites.type,
    DataEVPE.type,
    DataEHPE.type,
    // DataDistance.type, @todo take out till on click on axis uses current clicked series
    DataGPSAltitude.type,
    DataAbsolutePressure.type,
    DataPeakTrainingEffect.type,
    DataEPOC.type,
    DataEnergy.type,
    DataNumberOfSamples.type,
    DataBatteryCharge.type,
    DataBatteryCurrent.type,
    DataBatteryVoltage.type,
    DataBatteryConsumption.type,
    DataFormPower.type,
    DataLegStiffness.type,
    DataVerticalOscillation.type,
    DataTotalTrainingEffect.type,
  ]);

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
    this.dataTypesToUse = this.basicData;
    // Set the datatypes to show if all is selected
    if (this.showAllStats) {
      this.dataTypesToUse = this.allData;
    }
    // If there is a change in the chart settings and its valid update settings
    if (this.userChartSettings && !this.showAllStats) {
      // Set the datatypes to use
      // debugger;
      this.dataTypesToUse = Object.keys(this.userChartSettings.dataTypeSettings).reduce((dataTypesToUse, dataTypeSettingsKey) => {
        if (this.userChartSettings.dataTypeSettings[dataTypeSettingsKey].enabled === true) {
          dataTypesToUse.push(dataTypeSettingsKey);
        }
        return dataTypesToUse;
      }, []);
    }
    // 1. If there is no chart create
    if (!this.chart) {
      this.chart = await this.createChart();
    }

    // WARNING DO NOT ALLOW READS IF NOT VISIBLE! //

    // 2. If not visible and no data is bound do nothing
    if (!this.isVisible && (!this.streamsSubscription || this.streamsSubscription.closed)) {
      return;
    }

    // Beyond here component is visible and data is not bound //

    // 3. If something changed then do the needed
    if (simpleChanges.event || simpleChanges.selectedActivities || simpleChanges.showAllStats || simpleChanges.showOnlyOneYAxis || simpleChanges.userChartSettings) {
      if (!this.event || !this.selectedActivities.length) {
        this.unsubscribeAndClearChart();
        return;
      }
      this.unsubscribeAndClearChart();
      this.subscribeToNewData();
    }

    // 4. If nothing has changed but we do not have data binding then bind
    if (!this.streamsSubscription || this.streamsSubscription.closed) {
      this.subscribeToNewData();
    }

    // // 5 Invalidate if becoming visible @todo perhaps move higher?
    // if (simpleChanges.isVisible) {
    //   this.chart.deepInvalidate();
    // }
  }

  private subscribeToNewData() {
    this.loading();
    this.streamsSubscription = combineLatest(this.selectedActivities.map((activity) => {
      const allOrSomeSubscription = this.eventService.getStreamsByTypes(this.user, this.event.getID(), activity.getID(),
        this.dataTypesToUse,
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
    })).subscribe((series: am4charts.XYSeries[]) => {
      // Map the data
      // debugger;
      // series.forEach((series) => series.data = series.dummyData);

      // this.chart.deepInvalidate();
      // let data =
      // series.reduce((data, series) => {
      //   // debugger;
      //   series.dummyData.forEach((dataItem: { time: number, value: number | string | boolean }) => {
      //     if (!data[dataItem.time]) {
      //       data[dataItem.time] = {date: new Date(dataItem.time)}
      //     }
      //     data[dataItem.time][series.id] = dataItem.value;
      //   });
      //   return data;
      // }, {});

      // this.chart.data = Object.keys(data).map(key => data[key]).sort((dataItemA: any, dataItemB: any) => {
      //   return +dataItemA.date - +dataItemB.date;
      // });

    });
  }

  private createChart(): Promise<am4charts.XYChart> {
    return new Promise((resolve, reject) => {
      this.zone.runOutsideAngular(() => {
        // Create a chart
        const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);
        chart.pixelPerfect = false;
        // chart.fontSize = '0.85em';
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
        chart.legend.parent = legendContainer;

        chart.legend.itemContainers.template.events.on("hit", (ev) => {
          if (this.showOnlyOneYAxis) {
            return;
          }
          const series = <am4charts.LineSeries>ev.target.dataItem.dataContext;
          // Getting visible...
          if (!series.isHidden) {
            this.showSeriesYAxis(series)

            // if we should only focus on one y Axis then we need to hide all the rest exluding the shared ones
          } else { // .. hiding
            // Block hiding and do nothing with the axis if there is some other same type visible as they share the same axis
            // #notSameIDAndNotHiddenAndNoTSameName
            if (this.getVisibleSeriesWithSameYAxis(series).length > 0) {
              return;
            }
            this.hideSeriesYAxis(series)
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
        chart.scrollbarX = new am4charts.XYChartScrollbar();

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
          // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
          // if (this.chart.series.getIndex(0) && this.chart.series.getIndex(0).data && this.chart.series.getIndex(0).data.length) {
          //   this.loaded();
          // }
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

        resolve(chart);
      });
    });
  }

  private createOrUpdateChartSeries(activity: ActivityInterface, stream: StreamInterface): am4charts.XYSeries {
    let series = this.chart.series.values.find(series => series.id === `${activity.getID()}${stream.type}`);
    // If there is already a series with this id only data update should be done
    if (series) {
      series.data = this.convertStreamDataToSeriesData(activity, stream);
      return series
    }

    let yAxis: am4charts.Axis;

    if (this.showOnlyOneYAxis) {
      if (!this.chart.yAxes.length) {
        yAxis = this.chart.yAxes.push(new am4charts.ValueAxis()); // todo Same type series should be sharing a common axis
      } else {
        yAxis = this.chart.yAxes.getIndex(0);
      }
    } else {
      // Check if we have a series with the same name aka type
      const sameTypeSeries = this.chart.series.values.find((serie) => serie.name === stream.type);
      if (!sameTypeSeries) {
        yAxis = this.chart.yAxes.push(new am4charts.ValueAxis()); // todo Same type series should be sharing a common axis
      } else {
        // Share
        // debugger;
        yAxis = sameTypeSeries.yAxis;
      }
    }

    // Then create a series
    series = this.chart.series.push(new am4charts.LineSeries());
    // Set the axis
    series.yAxis = yAxis;
    // Add the tooltips
    // yAxis.adapter.add("getTooltipText", function (text, target, key) {
    //   return `${text} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit} `;
    // });

    // Setup the series
    series.id = `${activity.getID()}${stream.type}`;
    // series.name = stream.type + ` ${activity.creator.name}`;
    series.name = stream.type;
    // series.adapter.add("tooltipText", function (text, target, key) {
    //   debugger;
    //   return ">>> " + text + " <<<";
    // });
    series.tooltipText = `${activity.creator.name}  ${stream.type} {valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
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
    // series.fillOpacity = 0.1;
    // series.defaultState.transitionDuration = 0;
    series.dataFields.valueY = "value";
    series.dataFields.dateX = "time";
    series.interactionsEnabled = false;


    if ([DataHeartRate.type, DataAltitude.type].indexOf(stream.type) === -1) {
      this.hideSeries(series);
      // Disable the rest of the axis
      if (!this.showOnlyOneYAxis) {
        this.hideSeriesYAxis(series)
      }
    }

    // Attach events
    series.events.on('validated', (ev) => {
      this.logger.info('Series validated');
      this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      if (this.chart.series.getIndex(0) && this.chart.series.getIndex(0).data && this.chart.series.getIndex(0).data.length) {
        this.loaded();
      }
    });

    series.events.on('ready', (ev) => {
      this.logger.info('Series ready');
      // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
      // if (this.chart.series.getIndex(0) && this.chart.series.getIndex(0).data && this.chart.series.getIndex(0).data.length) {
      //   this.loaded();
      // }
    });

    // Finally set the data and return
    series.data = this.convertStreamDataToSeriesData(activity, stream);
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
    const hoursToKeep1sSamplingRateForAllActivities = 1; // 2 hours
    const hoursToKeep1sSamplingRate = hoursToKeep1sSamplingRateForAllActivities / (this.selectedActivities.length * 2);
    const numberOfSamplesToHours = numberOfSamples / 3600;
    if (numberOfSamplesToHours > hoursToKeep1sSamplingRate) {
      samplingRate = Math.ceil((numberOfSamplesToHours * 2) / hoursToKeep1sSamplingRate)
    }
    this.logger.info(`${numberOfSamples} for ${stream.type} are about ${numberOfSamplesToHours} hours. Sampling rate is ${samplingRate}`);
    return samplingRate;
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
    // this.chart.scrollbarX.series.clear();
    series.hidden = true;
    series.hide();
  }

  private showSeries(series: am4charts.XYSeries) {
    // this.chart.scrollbarX.series.push(series);
    series.hidden = false;
    series.show()
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

  ngOnDestroy() {
    this.destroyChart();
    this.unSubscribeFromAll();
  }

}
