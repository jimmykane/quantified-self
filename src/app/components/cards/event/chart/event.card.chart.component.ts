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
import {Log} from 'ng2-logger/client'
import {AppEventColorService} from '../../../../services/color/app.event.color.service';
import * as Raven from 'raven-js';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {DataLongitudeDegrees} from 'quantified-self-lib/lib/data/data.longitude-degrees';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {PointInterface} from 'quantified-self-lib/lib/points/point.interface';
import {DataLatitudeDegrees} from 'quantified-self-lib/lib/data/data.latitude-degrees';
import {DataHeartRate} from 'quantified-self-lib/lib/data/data.heart-rate';
import * as am4core from "@amcharts/amcharts4/core";
import * as am4charts from "@amcharts/amcharts4/charts";
import am4themes_animated from "@amcharts/amcharts4/themes/animated";
import am4themes_material from "@amcharts/amcharts4/themes/material";
import am4themes_kelly from "@amcharts/amcharts4/themes/kelly";

// am4core.useTheme(am4themes_animated);
am4core.useTheme(am4themes_material);

// am4core.useTheme(am4themes_kelly);

@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCardChartComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @ViewChild('chartDiv') chartDiv: ElementRef;
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible: boolean;

  private chart: am4charts.XYChart;
  private logger = Log.create('EventCardChartComponent');

  constructor(private  changeDetector: ChangeDetectorRef,
              private zone: NgZone,
              private eventColorService: AppEventColorService) {
  }

  ngAfterViewInit() {
    this.createChart().then((chart) => {
      this.chart = chart;
      this.getChartSeries().forEach(series => this.chart.series.push(series));
    })
  }

  ngOnInit() {
  }

  ngOnChanges(simpleChanges): void {
    if (this.chart && (simpleChanges.selectedActivities || simpleChanges.event)) {
      if (this.selectedActivities.length) {
        this.chart.series.setAll(this.getChartSeries());
      } else {
        this.chart.series.clear();
      }
    }
  }


  private createChart(): Promise<am4charts.XYChart> {
    return new Promise((resolve, reject) => {
      this.zone.runOutsideAngular(() => {
        const chart = am4core.create(this.chartDiv.nativeElement, am4charts.XYChart);

        chart.fontSize = '12px';
        // chart.resizable = false;
        let categoryAxis = chart.xAxes.push(new am4charts.DateAxis());
        let valueAxis = chart.yAxes.push(new am4charts.ValueAxis());

        chart.legend = new am4charts.Legend();
        chart.legend.nonScaling = true;
        chart.cursor = new am4charts.XYCursor();

        chart.events.on("validated", (ev) => {
          this.logger.d('Validated');
          const eventChart: am4charts.XYChart = ev.target;
          eventChart.svgContainer.style.height = String(100 + ((eventChart.series.length - 1) * 100)) + '%';
          eventChart.legend.height = new am4core.Percent(50);

        });
        chart.events.on("inited", (ev) => {
          this.logger.d('inited');
        });
        chart.events.on("valueschanged", (ev) => {
          this.logger.d('valueschanged');
        });

        resolve(chart);
      });
    });
  }

  private getChartSeries(): am4charts.LineSeries[] {
    return this.selectedActivities.reduce((lineSeriesArray: am4charts.LineSeries[], activity: ActivityInterface, index): am4charts.LineSeries[] => {
      activity.getPointsInterpolated(void 0, void 0).forEach((point: PointInterface) => {
        point.getData().forEach((pointData: DataInterface, key: string) => {
          if ([DataLatitudeDegrees.type, DataLongitudeDegrees.type].indexOf(key) > -1) {
            return;
          }

          let existingLineSeries = lineSeriesArray.find(lineSeries => lineSeries.id === pointData.getClassName() + activity.getID());

          if (!existingLineSeries) {
            existingLineSeries = new am4charts.LineSeries();
            existingLineSeries.id = pointData.getClassName() + activity.getID();
            existingLineSeries.name = key + ' (' + activity.creator.name + ')';

            existingLineSeries.dataFields.dateX = "date";
            existingLineSeries.dataFields.valueY = key;
            if (key !== DataHeartRate.type) {
              existingLineSeries.disabled = true
            }
            existingLineSeries.tooltipText = "{valueY} " + pointData.getDisplayUnit();
            existingLineSeries.legendSettings.labelText = "{name}";
            // existingLineSeries.legendSettings.valueText = "{valueY.close}";
            existingLineSeries.legendSettings.itemValueText = "{valueY} " + pointData.getDisplayUnit();
            existingLineSeries.defaultState.transitionDuration = 1000;

            existingLineSeries.strokeWidth = 1;
            existingLineSeries.fillOpacity = 0.05;
            if (pointData.getType() === DataHeartRate.type) {
              existingLineSeries.stroke = am4core.color(this.eventColorService.getActivityColor(this.event, activity));
            }

            lineSeriesArray.push(existingLineSeries);
          }

          existingLineSeries.data.push({
            date: point.getDate().getTime(),
            [key]: pointData.getDisplayValue(),
          })
        });
      });
      return lineSeriesArray
    }, []);
  }

  private destroyChart() {
    try {
      this.zone.runOutsideAngular(() => {
        if (this.chart) {
          this.chart.dispose();
          delete this.chart;
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
