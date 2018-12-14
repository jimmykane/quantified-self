import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  NgZone,
  ElementRef,
  ViewChild,
} from '@angular/core';
import {Log} from 'ng2-logger/browser'
import {AppEventColorService} from '../../../../services/color/app.event.color.service';
import * as Raven from 'raven-js';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {DataLongitudeDegrees} from 'quantified-self-lib/lib/data/data.longitude-degrees';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {PointInterface} from 'quantified-self-lib/lib/points/point.interface';
import {DataLatitudeDegrees} from 'quantified-self-lib/lib/data/data.latitude-degrees';
import {DataHeartRate} from 'quantified-self-lib/lib/data/data.heart-rate';
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';

import am4themes_animated from '@amcharts/amcharts4/themes/animated';
import am4themes_material from '@amcharts/amcharts4/themes/material';
import am4themes_kelly from '@amcharts/amcharts4/themes/kelly';
import {combineLatest, EMPTY, Subscription} from 'rxjs';
import {EventService} from '../../../../services/app.event.service';
import {DataAltitude} from 'quantified-self-lib/lib/data/data.altitude';
import {map} from 'rxjs/operators';
import {StreamInterface} from 'quantified-self-lib/lib/streams/stream.interface';


// am4core.useTheme(am4themes_animated);
// am4core.useTheme(am4themes_material);

// am4core.useTheme(am4themes_kelly);

@Component({
  selector: 'app-event-card-chart-new',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCardChartNewComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartDiv') chartDiv: ElementRef;
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible: boolean;

  private streamsSubscription: Subscription;
  private chart: am4charts.XYChart;
  private logger = Log.create('EventCardChartComponent');

  constructor(private  changeDetector: ChangeDetectorRef,
              private zone: NgZone,
              private eventService: EventService,
              private eventColorService: AppEventColorService) {
  }

  ngAfterViewInit() {

  }

  async ngOnInit() {
    // If it does not have a chart create no matter what change happened
    if (!this.chart) {
      this.chart = await this.createChart();
    }
    this.unSubscribeFromAll();
    this.streamsSubscription = combineLatest(this.selectedActivities.map((activity) => {
      return this.eventService.getStreams(
        this.event.getID(), activity.getID(),
        [
          DataHeartRate.type,
          DataAltitude.type,
        ],
      ).pipe(map((streams) => {
        if (!streams.length) {
          return [];
        }
        // debugger;
        return streams.map((stream) => {
          let series = this.chart.series.values.find((series) => {
            return stream.type === series.id
          });

          if (!series) {
            // debugger;
            series = new am4charts.LineSeries();
            series.id = `${activity.getID()}${stream.type}`;
            series.name = stream.type + ` ${activity.creator.name}`;
            series.dataFields.valueY = "value";
            series.dataFields.dateX = "date";
            series.hidden = true;
            // debugger;

            // hide all except the first one
            if (this.chart.series.length > 0) {
              // series.hide()
            }

            // series.minDistance = 1;
            // series.strokeWidth = 3;
            series.fillOpacity = 0.6;
            series.interactionsEnabled = false;
            // debugger;
          }

          // @todo for performance this should be moved to the other pipe
          series.data = stream.data.reduce((dataArray, streamData, index) => {
            // Slice the data dirty for now till performance is achieved
            // @todo fix
            if (streamData && (index % 10 === 0)) {
              dataArray.push({
                date: new Date(activity.startDate.getTime() + (index * 1000)),
                value: streamData,
              })
            }
            return dataArray
          }, []);
          return series
        });
      }))
    })).pipe(map((seriesArrayOfArrays) => {
      return seriesArrayOfArrays.reduce((accu: [], item: []): am4charts.LineSeries[] => accu.concat(item), [])
    })).subscribe((series) => {
      // debugger;

      this.chart.series.setAll(series);

      this.chart.invalidateData();
    });
  }

  async ngOnChanges(simpleChanges) {
  }

  private createChart(): Promise<am4charts.XYChart> {
    return new Promise((resolve, reject) => {
      this.zone.runOutsideAngular(() => {
        const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);
        chart.pixelPerfect = false;
        // chart.fontSize = '12px';
        // chart.resizable = false;
        const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
        dateAxis.title.text = "Time";
        const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

        chart.legend = new am4charts.Legend();
        chart.cursor = new am4charts.XYCursor();
        chart.cursor.fullWidthLineX = true;

        // Add watermark
        const watermark = new am4core.Label();
        watermark.text = "Quantified Self (https://quantified-self.io)";
        chart.plotContainer.children.push(watermark);
        watermark.align = "right";
        watermark.valign = "bottom";
        watermark.fontSize = 20;
        watermark.opacity = 0.9;
        watermark.marginRight = 10;
        watermark.marginBottom = 5;
        // watermark.zIndex = 100;
        watermark.fontWeight = 'bold';


        chart.events.on('validated', (ev) => {
          this.logger.d('Validated');
          // const eventChart: am4charts.XYChart = ev.target;
          // eventChart.svgContainer.style.height = String(100 + ((eventChart.series.length - 1) * 100)) + '%';
          // eventChart.legend.height = new am4core.Percent(50);

        });

        chart.events.on('datavalidated', (ev) => {
          this.logger.d('DataValidated');
          var chart: am4charts.XYChart = ev.target;
          var categoryAxis = chart.yAxes.getIndex(0);
          // debugger;
          var adjustHeight = chart.pixelHeight + categoryAxis.pixelHeight;
          // get current chart height
          var targetHeight = chart.pixelHeight + adjustHeight;

          // debugger
          chart.svgContainer.htmlElement.style.height = chart.svgContainer.htmlElement.offsetHeight + categoryAxis.pixelHeight/4 + 'px';

          // debugger;
        });

        chart.events.on('inited', (ev) => {
          this.logger.d('inited');
        });
        resolve(chart);
      });
    });
  }

  private getChartData(): { series: am4charts.LineSeries[], data: any[] } {
    const chartData = {series: [], data: []};
    // Use a map for quick lookup
    const data = new Map<number, any>();
    // Parse the series while constructing data
    this.selectedActivities
      .forEach((activity: ActivityInterface, index) => {
        activity.getPointsInterpolated(void 0, void 0).forEach((point: PointInterface) => {
          point.getData().forEach((pointData: DataInterface, key: string) => {
            if ([DataLatitudeDegrees.type, DataLongitudeDegrees.type].indexOf(key) > -1) {
              return;
            }

            let existingLineSeries: am4charts.LineSeries = chartData.series.find(lineSeries => lineSeries.id === pointData.getClassName() + activity.getID());

            if (!existingLineSeries) {
              existingLineSeries = new am4charts.LineSeries();
              existingLineSeries.id = pointData.getClassName() + activity.getID();
              existingLineSeries.name = key + ' (' + activity.creator.name + ')';

              existingLineSeries.dataFields.dateX = 'date';
              existingLineSeries.dataFields.valueY = pointData.getClassName() + activity.getID();
              if (key !== DataHeartRate.type) {
                existingLineSeries.hidden = true;
              }
              existingLineSeries.tooltipText = activity.creator.name + ' ' + pointData.getType() + '{valueY} ' + pointData.getDisplayUnit();
              existingLineSeries.legendSettings.labelText = '{name}';
              existingLineSeries.legendSettings.itemValueText = '{valueY} ' + pointData.getDisplayUnit();
              existingLineSeries.defaultState.transitionDuration = 0;

              existingLineSeries.strokeWidth = 1;
              existingLineSeries.fillOpacity = 0.05;
              // existingLineSeries.nonScalingStroke = false;
              if (pointData.getType() === DataHeartRate.type) {
                existingLineSeries.stroke = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
              }
              chartData.series.push(existingLineSeries);
            }

            let existingData = data.get(point.getDate().getTime());
            if (!existingData) {
              existingData = {};
              data.set(point.getDate().getTime(), existingData);
            }
            existingData[pointData.getClassName() + activity.getID()] = pointData.getDisplayValue();
          });
        });
      });

    // Flatten
    data.forEach(((value, key, map) => {
      chartData.data.push(Object.assign({date: new Date(key)}, value))
    }));
    return chartData;
  }

  private destroyChart() {
    try {
      this.zone.runOutsideAngular(() => {
        if (this.chart) {
          this.chart.dispose();
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
  }

  private unSubscribeFromAll() {
    if (this.streamsSubscription) {
      this.streamsSubscription.unsubscribe();
    }
  }
}
