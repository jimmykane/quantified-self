import {
  AfterViewInit,
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {AmChartsService} from '@amcharts/amcharts3-angular';
import {Log} from 'ng2-logger/client'
import {AppEventColorService} from '../../../../services/color/app.event.color.service';
import {ChartDataSettingsInterface} from './event.card.chart.data.interface';
import * as Raven from 'raven-js';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {DataLongitudeDegrees} from 'quantified-self-lib/lib/data/data.longitude-degrees';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {PointInterface} from 'quantified-self-lib/lib/points/point.interface';
import {DataLatitudeDegrees} from 'quantified-self-lib/lib/data/data.latitude-degrees';
import {DataHeartRate} from 'quantified-self-lib/lib/data/data.heart-rate';

@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCardChartComponent implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[] = [];
  @Input() isVisible: boolean;

  private chart: any;
  private chartData: ChartDataSettingsInterface;

  private logger = Log.create('EventCardChartComponent');

  constructor(private  changeDetector: ChangeDetectorRef,
              private eventColorService: AppEventColorService,
              private AmCharts: AmChartsService) {
  }

  ngAfterViewInit() {
  }

  ngOnInit() {
  }

  ngOnChanges(simpleChanges): void {
    debugger;
    // If the only change was to unselect all then clean up and return
    if ((simpleChanges.event || simpleChanges.selectedActivities) && !this.selectedActivities.length) {
      this.destroyChart();
      this.chartData = null;
      return;
    }
    // If data changed... update
    if (simpleChanges.selectedActivities || simpleChanges.event) {
      this.destroyChart(); // Destroy to recreate (no update as its messy atm)
      this.chartData = this.getAllData();
    }

    // If we do not have a chart but we become visible
    if (!this.chart && this.isVisible) { // If there is no chart and the component becomes of is visible
      this.createChart(this.chartData); // Create the chart
    }
  }

  private createChart(chartData: ChartDataSettingsInterface) {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      // Create a fresh one
      this.chart = this.AmCharts.makeChart('chartdiv', this.getAmChartOptions(chartData), 1);
      this.addListenersToChart();

      const t1 = performance.now();
      this.logger.d('Created chart after ' + (t1 - t0) + ' milliseconds');
      resolve(true);
    });
  }

  private addListenersToChart() {
    if (!this.chart.events.rendered.length) {
      this.chart.addListener('rendered', () => {
        this.logger.d('Rendered')
      });
    }

    if (!this.chart.events.init.length) {
      this.chart.addListener('init', () => {
        this.logger.d('Init')
      });
    }

    if (!this.chart.events.dataUpdated.length) {
      // this.chart.addListener('dataUpdated', (event) => {
      //   event.chart.valueAxes.forEach((valueAxis) => {
      //     valueAxis.guides = this.getAverageGuide();
      //   });
      //   event.chart.validateNow();
      // });
      this.logger.d('DataUpdated')

    }

    if (!this.chart.events.resized.length) {
      this.chart.addListener('resized', () => {
      });
    }

    if (!this.chart.events.zoomed.length) {
      this.chart.addListener('zoomed', (event) => {
      });
    }

    if (!this.chart.events.buildStarted.length) {
      this.chart.addListener('buildStarted', () => {
      });
    }

    if (!this.chart.events.changed.length) {
      this.chart.addListener('changed', () => {
      });
    }

    if (!this.chart.events.drawn.length) {
      this.chart.addListener('drawn', () => {
        this.logger.d('Drawn')
      });
    }
  }

  private getAllData(): ChartDataSettingsInterface {
    const t0 = performance.now();
    const chartData: ChartDataSettingsInterface = {
      categories: new Map<string, any>(),
      dataByDateTime: new Map<number, any>(),
      dataProvider: [],
    };
    this.selectedActivities.forEach((activity: ActivityInterface, index) => {
      activity.getPointsInterpolated(void 0, void 0).forEach((point: PointInterface) => {
        point.getData().forEach((pointData: DataInterface, key: string) => {
          if ([DataLatitudeDegrees.type, DataLongitudeDegrees.type].indexOf(key) > -1) {
            return;
          }

          let existingCategory = chartData.categories.get(key + activity.getID());
          if (!existingCategory) {
            existingCategory = {
              graph: this.getGraph(activity, pointData),
            };
            chartData.categories.set(key + activity.getID(), existingCategory);
          }

          let existingDateData = chartData.dataByDateTime.get(point.getDate().getTime());
          if (!existingDateData) {
            existingDateData = new Map<string, number>();
            chartData.dataByDateTime.set(point.getDate().getTime(), existingDateData);
          }
          existingDateData.set(key + activity.getID(), pointData.getDisplayValue());
        });
      });
    });

    // Flatten the data
    chartData.dataByDateTime.forEach((dataMap, dateTime, map) => {
      chartData.dataProvider.push(Object.assign({
        date: new Date(dateTime),
      }, Array.from(dataMap).reduce((obj, [key, value]) => (
        Object.assign(obj, {[key]: value})
      ), {})));
    });

    // Sort them
    chartData.dataProvider.sort((dataA: any, dataB: any) => {
      return +dataA.date - +dataB.date;
    });

    this.logger.d('Retrieved all data after ' + (performance.now() - t0) + ' milliseconds');
    return chartData;
  }

  private getGraph(activity: ActivityInterface, data: DataInterface) {
    return {
      id: data.getType() + activity.getID(),
      activity: activity,
      valueAxis: data.getType() + activity.getID(),
      lineColor: data.getType() !== DataHeartRate.type ? false : this.eventColorService.getActivityColor(this.event, activity),
      bulletBorderThickness: 3,
      hideBulletsCount: 1,
      title: data.getType() + ' (' + activity.creator.name + ')',
      valueField: data.getType() + activity.getID(),
      balloonText: data.getType() + '<br><b><span>[[value]] ' + data.getDisplayUnit() + '</span></b></br>' + activity.creator.name,
      legendValueText: '[[value]] ' + data.getDisplayUnit(),
      fillAlphas: 0.05,
      lineThickness: 1.5,
      useLineColorForBulletBorder: true,
      type: 'line',
      hidden: data.getType() !== DataHeartRate.type,
    }
  }

  private getAverageGuide(graph) {
    return {
      value: 120,
      // toValue: 120,
      lineAlpha: 0.5,
      lineThickness: 0.5,
      lineColor: '#000000',
      label: 'Z1',
      position: 'right',
      inside: true,
      boldLabel: true,
    };
  }

  private getScrollbarForGraph(graph) {
    return {
      hideResizeGrips: true,
      autoGridCount: true,
      graphType: 'line',
      graph: graph.id,
      gridAlpha: 0,
      color: '#888888',
      scrollbarHeight: 55,
      backgroundAlpha: 0,
      selectedBackgroundAlpha: 0.1,
      selectedBackgroundColor: '#888888',
      graphFillAlpha: 0,
      selectedGraphFillAlpha: 0,
      graphLineAlpha: 0.2,
      graphLineColor: '#c2c2c2',
      selectedGraphLineColor: '#888888',
      selectedGraphLineAlpha: 1,
      usePeriod: 'WW',
      offset: 10,
    };
  }

  private getAmChartOptions(chartData: ChartDataSettingsInterface) {
    const graphs = Array.from(chartData.categories.values()).reduce((graphArray, category) => {
      graphArray.push(category.graph);
      return graphArray;
    }, []).sort((graphA, graphB) => graphA.id.localeCompare(graphB.id));
    if (!graphs.find((graph) => {
      return graph.hidden !== true
    })) {
      if (graphs[0]) {
        graphs[0].hidden = false;
      }
    }
    return {
      type: 'serial',
      theme: 'light',
      dataProvider: chartData.dataProvider,
      autoMarginOffset: 0,
      // marginRight: 100,
      // autoMargins: true,
      graphs: graphs,
      // autoTransform: false,
      // autoResize: false,
      // autoDisplay: false,
      // responsive: {
      //   enabled: false
      // },
      // valueAxes: [{
      //   gridThickness: 0.0,
      // }],
      startDuration: 0.2,
      startEffect: 'easeOutSine',
      sequencedAnimation: false,
      categoryField: 'date',
      processCount: 10000,
      // processTimeout: 1,
      legend: {
        align: 'center',
        useGraphSettings: true,
        autoMargins: true,
        marginTop: 0,
        valueText: '[[value]]',
        clickLabel: (graph) => {
          graph.hidden = !graph.hidden;
          if (graph.hidden) {
            // Reset the color
            delete graph.lineColor;
            // Update the chart
            graph.chart.invalidateSize();
            return;
          }
          // Focus the scrollbar (get it)
          graph.chart.chartScrollbar = this.getScrollbarForGraph(graph);
          const sameActivityVisibleGraphs = graph.chart.graphs.filter(graphObj => !graphObj.hidden && graph.activity === graphObj.activity);
          // If the graphs are less than the selected activities add the device color, else
          if (sameActivityVisibleGraphs.length < this.selectedActivities.length) {
            graph.lineColor = this.eventColorService.getActivityColor(this.event, graph.activity);
          }
          graph.chart.invalidateSize();
        },
      },
      synchronizeGrid: true,
      categoryAxis: {
        parseDates: true,
        minPeriod: 'fff',
        axisColor: '#DADADA',
        gridThickness: 0.0,
        offset: 0,
        labelOffset: 0,
        // minorGridEnabled: true,
      },
      chartCursor: {
        valueZoomable: true,
        categoryBalloonDateFormat: 'JJ:NN:SS',
        cursorAlpha: 0,
        valueLineEnabled: true,
        valueLineBalloonEnabled: true,
        valueLineAlpha: 0.5,
        fullWidth: true,
      },
      chartScrollbar: graphs.length ? this.getScrollbarForGraph(graphs.find(graph => !graph.hidden)) : false,
      creditsPosition: 'bottom-right',
    }
  }

  private destroyChart() {
    if (!this.chart) {
      return;
    }
    // There can be the case where the chart has not finished bulding and the user navigated away
    // thus no chart to destroy
    try {
      this.AmCharts.destroyChart(this.chart);
      delete this.chart;
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
