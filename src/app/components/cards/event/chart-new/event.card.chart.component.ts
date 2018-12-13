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
import {Subscription} from 'rxjs';
import {EventService} from '../../../../services/app.event.service';
import {DataAltitude} from 'quantified-self-lib/lib/data/data.altitude';

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

  private streamsSubscriptions: Subscription[] = [];
  private chart: am4charts.XYChart;
  private logger = Log.create('EventCardChartComponent');

  constructor(private  changeDetector: ChangeDetectorRef,
              private zone: NgZone,
              private eventService: EventService,
              private eventColorService: AppEventColorService) {
  }

  ngAfterViewInit() {

  }

  ngOnInit() {
  }

  async ngOnChanges(simpleChanges) {
    if (this.isVisible && !this.chart) {
      this.chart = await this.createChart();
    }
    if (!this.isVisible) {
      return;
    }
    // If this is visible but nothing internaly changed noop
    if (!simpleChanges.selectedActivities && !simpleChanges.event){
      return;
    }
    // debugger;
    this.unSubscribeFromAll();
    this.selectedActivities.forEach((activity) => {
      this.streamsSubscriptions.push(
        this.eventService.getStreams(
          this.event.getID(), activity.getID(),
          [
            DataHeartRate.type,
            // DataAltitude.type,
          ],
        ).subscribe((streams) => {
          if (!streams.length) {
            return;
          }
          // debugger;
          streams.forEach((stream) => {
            let series = this.chart.series.values.find((series) => {
              return stream.type === series.id
            });

            if (!series) {
              // debugger;
              series = new am4charts.LineSeries();
              series.id = `${activity.getID()}${stream.type}`;
              series.name = stream.type;
              series.dataFields.valueY = "value";
              series.dataFields.dateX = "date";
              series.strokeWidth = 1;
              series.fillOpacity = 0.6;
              series.interactionsEnabled = false;

              this.chart.series.push(series)
            }

            series.data = stream.data.reduce((dataArray, streamData, index) => {
              if (streamData) {
                dataArray.push({
                  date: new Date(activity.startDate.getTime() + (index * 1000)),
                  value: streamData,
                })
              }
              return dataArray
            }, []);

          });
          // debugger;
        }))
    })
  }


  private createChart(): Promise<am4charts.XYChart> {
    return new Promise((resolve, reject) => {
      this.zone.runOutsideAngular(() => {
        const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);
        chart.pixelPerfect = false;
        chart.fontSize = '12px';
        // chart.resizable = false;
        const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
        dateAxis.title.text = "Time";
        const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

        chart.legend = new am4charts.Legend();
        chart.cursor = new am4charts.XYCursor();
        chart.cursor.fullWidthLineX = true;


        chart.events.on('validated', (ev) => {
          this.logger.d('Validated');
          // const eventChart: am4charts.XYChart = ev.target;
          // eventChart.svgContainer.style.height = String(100 + ((eventChart.series.length - 1) * 100)) + '%';
          // eventChart.legend.height = new am4core.Percent(50);

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
    this.unSubscribeFromAll();
    this.destroyChart();
  }

  private unSubscribeFromAll() {
    this.streamsSubscriptions.forEach((streamsSubscription) => {
      streamsSubscription.unsubscribe()
    });
  }
}


// private getAmChartOptions(chartData: ChartDataSettingsInterface) {
//   // Get and short, and if none is visible then show the first one
//   const graphs = Array.from(chartData.categories.values()).reduce((graphArray, category) => {
//     graphArray.push(category.graph);
//     return graphArray;
//   }, []).sort((graphA, graphB) => graphA.id.localeCompare(graphB.id));
//   if (!graphs.find((graph) => {
//     return graph.hidden !== true
//   })) {
//     if (graphs[0]) {
//       graphs[0].hidden = false;
//     }
//   }
//   return {
//     type: 'serial',
//     theme: 'light',
//     dataProvider: chartData.dataProvider,
//     autoMarginOffset: 0,
//     parseDates: true,
//     // marginRight: 100,
//     // autoMargins: true,
//     graphs: graphs,
//     // autoTransform: false,
//     // autoResize: false,
//     // autoDisplay: false,
//     // responsive: {
//     //   enabled: false
//     // },
//     valueAxes: graphs.reduce((array, graph) => {
//       // const valueAxis: any = {};
//       // if (graph.dataType === DataPace.type) {
//       //   valueAxis.id = graph.id;
//       //   // valueAxis.reversed = true;
//       //   // valueAxis.fillAlpha = 0;
//       //   // valueAxis.duration = 'ss';
//       // }
//       // array.push(valueAxis);
//       return array;
//     }, []),
//     startDuration: 0.2,
//     startEffect: 'easeOutSine',
//     sequencedAnimation: false,
//     categoryField: 'date',
//     processCount: 10000,
//     // processTimeout: 1,
//     legend: {
//       align: 'center',
//       useGraphSettings: true,
//       autoMargins: true,
//       marginTop: 0,
//       valueText: '[[value]]',
//       clickLabel: (graph) => {
//         graph.hidden = !graph.hidden;
//         if (graph.hidden) {
//           // Reset the color
//           delete graph.lineColor;
//           // Update the chart
//           graph.chart.invalidateSize();
//           return;
//         }
//         // Focus the scrollbar (get it)
//         graph.chart.chartScrollbar = this.getScrollbarForGraph(graph);
//         const sameActivityVisibleGraphs = graph.chart.graphs.filter(graphObj => !graphObj.hidden && graph.activity === graphObj.activity);
//         // If the graphs are less than the selected activities add the device color, else
//         if (sameActivityVisibleGraphs.length < this.selectedActivities.length) {
//           graph.lineColor = this.eventColorService.getActivityColor(this.event, graph.activity);
//         }
//         graph.chart.invalidateSize();
//       },
//     },
//     synchronizeGrid: true,
//     categoryAxis: {
//       parseDates: true,
//       minPeriod: 'fff',
//       axisColor: '#DADADA',
//       gridThickness: 0.0,
//       offset: 0,
//       labelOffset: 0,
//       minorGridEnabled: true,
//     },
//     chartCursor: {
//       valueZoomable: true,
//       categoryBalloonDateFormat: 'JJ:NN:SS',
//       cursorAlpha: 0,
//       valueLineEnabled: true,
//       valueLineBalloonEnabled: true,
//       valueLineAlpha: 0.5,
//       fullWidth: true,
//     },
//     chartScrollbar: graphs.length ? this.getScrollbarForGraph(graphs.find(graph => !graph.hidden)) : false,
//     creditsPosition: 'bottom-right',
//   }
// }
