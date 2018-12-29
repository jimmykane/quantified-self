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
import {DataLongitudeDegrees} from 'quantified-self-lib/lib/data/data.longitude-degrees';
import {DataLatitudeDegrees} from 'quantified-self-lib/lib/data/data.latitude-degrees';
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
import {isNumber} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataPace} from 'quantified-self-lib/lib/data/data.pace';
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
import {AppUser} from '../../../../authentication/app.auth.service';


// am4core.useTheme(am4themes_animated);
// am4core.useTheme(am4themes_material);

// am4core.useTheme(am4themes_kelly);

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
  @Input() user: AppUser;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible: boolean;
  @Input() showAdvancedStats: boolean;

  private streamsSubscription: Subscription;
  private chart: am4charts.XYChart;
  private logger = Log.create('EventCardChartComponent');

  private simpleStats = [
    DataHeartRate.type,
    DataAltitude.type,
    DataCadence.type,
    DataPower.type,
    DataPace.type,
    DataSpeed.type,
    DataVO2Max.type,
  ];

  private advancedStats = this.simpleStats.concat([
    DataTemperature.type,
    DataSeaLevelPressure.type,
    DataSatellite5BestSNR.type,
    DataNumberOfSatellites.type,
    DataLongitudeDegrees.type,
    DataLatitudeDegrees.type,
    DataEVPE.type,
    DataEHPE.type,
    DataDistance.type,
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
    if (simpleChanges.event || simpleChanges.selectedActivities || simpleChanges.showAdvancedStats) {
      if (!this.event || !this.selectedActivities.length) {
        this.unSubscribeFromAll();
        this.chart.series.clear();
        return;
      }
      this.chart.series.clear();
      this.unsubscribeAndBindToNewData();
    }

    // 4. If nothing has changed but we do not have data binding then bind
    if (!this.streamsSubscription || this.streamsSubscription.closed) {
      this.unsubscribeAndBindToNewData();
    }

    // 5 Invalidate if becoming visible @todo perhaps move higher?
    if (simpleChanges.isVisible) {
      this.chart.invalidate();
    }
  }

  private unsubscribeAndBindToNewData() {
    this.unSubscribeFromAll();
    this.streamsSubscription = combineLatest(this.selectedActivities.map((activity) => {
      const allOrSomeSubscription = this.eventService.getStreamsByTypes(this.user, this.event.getID(), activity.getID(),
        this.showAdvancedStats ? this.advancedStats : this.simpleStats,
      );
      return allOrSomeSubscription.pipe(map((streams) => {
        if (!streams.length) {
          return [];
        }
        // debugger;
        return streams.map((stream) => {
          let series = this.chart.series.values.find(series => series.id === `${activity.getID()}${stream.type}`);
          if (!series) {
            series = this.chart.series.push(this.createSeriesFromStream(activity, stream));
          }
          series.data = this.convertSreamDataToSeriesData(activity, stream);
          return series
        });
      }))
    })).pipe(map((seriesArrayOfArrays) => {
      // Format flatten the arrays as they come in [[], []]
      return seriesArrayOfArrays.reduce((accu: [], item: []): am4charts.XYSeries[] => accu.concat(item), [])
    })).subscribe((series: am4charts.XYSeries[]) => {
      this.chart.invalidate(); // @todo peghaps this is not needed

      // @todo here it should perhaps remove the ones not available instread of doing a clear at start
      // The below is buggy
      // this.chart.series.values.forEach((chartSeries) => {
      //   if (series.map((serrie) => serrie.id).indexOf(chartSeries.id) === -1) {
      //     this.chart.series.removeIndex(
      //       this.chart.series.indexOf(chartSeries),
      //     ).dispose();
      //     this.logger.d(`remove ${chartSeries.id} with index ${this.chart.series.indexOf(chartSeries)}`);
      //   }
      // });
      // @todo https://www.amcharts.com/docs/v4/tutorials/chart-legend-in-an-external-container/
    });
  }

  private createChart(): Promise<am4charts.XYChart> {
    return new Promise((resolve, reject) => {
      this.zone.runOutsideAngular(() => {
        const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);
        chart.pixelPerfect = false;
        // chart.fontSize = '12px';
        // chart.resizable = false;
        const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
        // dateAxis.skipEmptyPeriods= true;
        dateAxis.title.text = "Time";
        // dateAxis.baseInterval = {
        //   timeUnit: "second",
        //   count: this.getStreamSamplingRateInSeconds(this.selectedActivities),
        // };
        const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

        // chart.durationFormatter.durationFormat = " mm ':' ss 'min/km'";

        chart.legend = new am4charts.Legend();
        chart.cursor = new am4charts.XYCursor();
        chart.cursor.fullWidthLineX = true;

        // Add watermark
        const watermark = new am4core.Label();
        watermark.text = "quantified-self.io";
        chart.plotContainer.children.push(watermark);
        watermark.align = "right";
        watermark.valign = "bottom";
        watermark.fontSize = 18;
        watermark.opacity = 0.6;
        watermark.marginRight = 10;
        watermark.marginBottom = 5;
        watermark.zIndex = 100;
        // watermark.fontWeight = 'bold';


        // Legend
        chart.legend = new am4charts.Legend();
        var legendContainer = am4core.create(this.legendDiv.nativeElement, am4core.Container);
        legendContainer.width = am4core.percent(100);
        legendContainer.height = am4core.percent(100);
        chart.legend.parent = legendContainer;
        // chart.legend.padding(10, 10, 10 , 10);

        // Disable the preloader
        chart.preloader.disabled = true;


        chart.events.on('validated', (ev) => {
          this.logger.d('validated');
          // this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
        });

        chart.events.on('maxsizechanged', (ev) => {
          this.logger.d('maxsizechanged');
          this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";
        });

        chart.events.on('visibilitychanged', (ev) => {
          this.logger.d('visibilitychanged');
        });

        chart.events.on('hidden', (ev) => {
          this.logger.d('hidden');
        });
        chart.events.on('shown', (ev) => {
          this.logger.d('shown');
        });

        chart.events.on('inited', (ev) => {
          this.logger.d('inited');
        });

        chart.events.on('datavalidated', (ev) => {
          this.logger.d('datavalidated');
                    this.legendDiv.nativeElement.style.height = this.chart.legend.contentHeight + "px";

        });
        resolve(chart);
      });
    });
  }

  private createSeriesFromStream(activity: ActivityInterface, stream: StreamInterface): am4charts.LineSeries {
    const series = new am4charts.LineSeries();
    series.id = `${activity.getID()}${stream.type}`;
    series.name = stream.type + ` ${activity.creator.name}`;
    // series.adapter.add("tooltipText", function (text, target, key) {
    //   debugger;
    //   return ">>> " + text + " <<<";
    // });
    series.tooltipText = `${activity.creator.name}  ${stream.type} {valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
    // series.legendSettings.labelText = "[bold {stroke}]{name}[/]";
    // series.legendSettings.itemValueText = `{valueY} ${DynamicDataLoader.getDataClassFromDataType(stream.type).unit}`;
    // series.stroke = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
    // series.fill = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
    series.fillOpacity = 0.2;
    series.defaultState.transitionDuration = 0;
    series.dataFields.valueY = "value";
    series.dataFields.dateX = "date";
    // series.hidden = true;


    // if (stream.type === DataPace.type) {
    //   let yAxis = new am4charts.DurationAxis();
    //   yAxis.baseUnit = "second";
    //   yAxis.title.text = "Duration";
    //   series.yAxis = yAxis;
    //   this.chart.yAxes.push(yAxis)
    // }

    // series.minDistance = 1;
    // series.strokeWidth = 3;

    // series.interactionsEnabled = false;
    if (this.chart.series.length > 4) {
      // series.hide();
    }

    return series;
  }

  private convertSreamDataToSeriesData(activity: ActivityInterface, stream: StreamInterface): any {
    const samplingRate = this.getStreamSamplingRateInSeconds(stream);
    this.logger.d(`Stream data for ${stream.type} length before sampling ${stream.data.length}`);
    const data = stream.data.reduce((dataArray: { date: Date, value: number | string | boolean }[], streamData, index) => {
      if (!isNumber(streamData)) {
        return dataArray
      }
      dataArray.push({
        date: new Date(activity.startDate.getTime() + (index * 1000)),
        value: streamData, // Display value can be string this needs to be corrected
      });
      return dataArray
    }, [])
      .filter((data, index) => (index % samplingRate) === 0);
    this.logger.d(`Stream data for ${stream.type} after sampling and filtering ${data.length}`);
    return data;
  }

  private getStreamSamplingRateInSeconds(stream: StreamInterface): number {
    const numberOfSamples = stream.getNumericData().length;
    let samplingRate = 1;
    // Each sample is 1s so x number is x seconds
    const hoursToKeep1sSamplingRate = 1; // 1 hours
    const numberOfSamplesToHours = numberOfSamples / 3600;
    if (numberOfSamplesToHours > hoursToKeep1sSamplingRate) {
      samplingRate = Math.ceil((numberOfSamplesToHours * 7) / hoursToKeep1sSamplingRate)
    }
    this.logger.d(`${numberOfSamples} are about ${numberOfSamplesToHours} hours. Sampling rate is ${samplingRate}`);
    return samplingRate;
  }


  // private getChartData(): { series: am4charts.LineSeries[], data: any[] } {
  //   const chartData = {series: [], data: []};
  //   // Use a map for quick lookup
  //   const data = new Map<number, any>();
  //   // Parse the series while constructing data
  //   this.selectedActivities
  //     .forEach((activity: ActivityInterface, index) => {
  //       activity.getPointsInterpolated(void 0, void 0).forEach((point: PointInterface) => {
  //         point.getData().forEach((pointData: DataInterface, key: string) => {
  //           if ([DataLatitudeDegrees.type, DataLongitudeDegrees.type].indexOf(key) > -1) {
  //             return;
  //           }
  //
  //           let existingLineSeries: am4charts.LineSeries = chartData.series.find(lineSeries => lineSeries.id === pointData.getClassName() + activity.getID());
  //
  //           if (!existingLineSeries) {
  //             existingLineSeries = new am4charts.LineSeries();
  //             existingLineSeries.id = pointData.getClassName() + activity.getID();
  //             existingLineSeries.name = key + ' (' + activity.creator.name + ')';
  //
  //             existingLineSeries.dataFields.dateX = 'date';
  //             existingLineSeries.dataFields.valueY = pointData.getClassName() + activity.getID();
  //             if (key !== DataHeartRate.type) {
  //               existingLineSeries.hidden = true;
  //             }
  //             existingLineSeries.tooltipText = activity.creator.name + ' ' + pointData.getType() + '{valueY} ' + pointData.getDisplayUnit();
  //             existingLineSeries.legendSettings.labelText = '{name}';
  //             existingLineSeries.legendSettings.itemValueText = '{valueY} ' + pointData.getDisplayUnit();
  //             existingLineSeries.defaultState.transitionDuration = 0;
  //
  //             existingLineSeries.strokeWidth = 1;
  //             existingLineSeries.fillOpacity = 0.05;
  //             // existingLineSeries.nonScalingStroke = false;
  //             if (pointData.getType() === DataHeartRate.type) {
  //               existingLineSeries.stroke = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
  //             }
  //             chartData.series.push(existingLineSeries);
  //           }
  //
  //           let existingData = data.get(point.getDate().getTime());
  //           if (!existingData) {
  //             existingData = {};
  //             data.set(point.getDate().getTime(), existingData);
  //           }
  //           existingData[pointData.getClassName() + activity.getID()] = pointData.getDisplayValue();
  //         });
  //       });
  //     });
  //
  //   // Flatten
  //   data.forEach(((value, key, map) => {
  //     chartData.data.push(Object.assign({date: new Date(key)}, value))
  //   }));
  //   return chartData;
  // }

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

  private unSubscribeFromAll() {
    if (this.streamsSubscription) {
      this.streamsSubscription.unsubscribe();
    }
  }
}
