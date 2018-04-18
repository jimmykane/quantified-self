import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {DataInterface} from '../../../../entities/data/data.interface';
import {DataLatitudeDegrees} from '../../../../entities/data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../../entities/data/data.longitude-degrees';
import {EventInterface} from '../../../../entities/events/event.interface';
import {AmChartsService} from '@amcharts/amcharts3-angular';
import {DataHeartRate} from '../../../../entities/data/data.heart-rate';
import {DataCadence} from '../../../../entities/data/data.cadence';
import {DataAltitude} from '../../../../entities/data/data.altitude';
import {DataSpeed} from '../../../../entities/data/data.speed';
import {DataVerticalSpeed} from '../../../../entities/data/data.vertical-speed';
import {DataSeaLevelPressure} from '../../../../entities/data/data.sea-level-pressure';
import {Log, Level} from 'ng2-logger'
import {ActivityInterface} from '../../../../entities/activities/activity.interface';
import {PointInterface} from '../../../../entities/points/point.interface';
import {DataNumber} from "../../../../entities/data/data.number";


@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  styleUrls: ['./event.card.chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventCardChartComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  private dataMap: Map<string, Map<number, DataNumber[]>>;
  private categories = [];
  private chart: any;
  private selectedActivities = [];
  private logger = Log.create('EventCardChartComponent');

  constructor(private  changeDetector: ChangeDetectorRef, private AmCharts: AmChartsService) {
  }

  ngOnInit() {

  }

  ngOnChanges(): void {
    if (this.event.getActivities().length === 1) {
      this.selectedActivities = [this.event.getFirstActivity()];
      this.createAndUpdateChart();
    }
  }

  onSelectedActivities(activities) {
    this.selectedActivities = activities;
    if (this.selectedActivities.length) {
      this.createAndUpdateChart();
    } else if (this.chart) {
      this.AmCharts.destroyChart(this.chart);
    }

  }

  private createAndUpdateChart() {
    const t0 = performance.now();

    this.createChart().then(() => {
      this.logger.d('Chart create promise completed after ' +
        (performance.now() - t0) + ' milliseconds or ' +
        (performance.now() - t0) / 1000 + ' seconds'
      );
      this.updateChart().then(() => {
        this.logger.d('Chart update promise completed after ' +
          (performance.now() - t0) + ' milliseconds or ' +
          (performance.now() - t0) / 1000 + ' seconds'
        );
      });
    });
  }

  private createChart() {
    this.categories = [];
    this.dataMap = void 0;
    const graphs = this.getGraphs();
    // const valueAxes = this.getValueAxes();

    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      this.logger.d('Chart Create started after ' +
        (performance.now() - t0) + ' milliseconds or ' +
        (performance.now() - t0) / 1000 + ' seconds'
      );
      // Destroy existing chart
      if (this.chart) {
        this.AmCharts.destroyChart(this.chart);
      }
      // Create a fresh one
      this.chart = this.AmCharts.makeChart('chartdiv', {
        type: 'serial',
        theme: 'light',
        autoMarginOffset: 0,
        // marginRight: 100,
        autoMargins: true,
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
        startDuration: 0.3,
        startEffect: 'elastic',
        sequencedAnimation: false,
        categoryField: 'date',
        // processCount: 1000,
        // processTimeout: 2000,
        legend: {
          align: 'center',
          useGraphSettings: true,
          autoMargins: true,
          marginTop: 0,
          valueText: '[[value]]',
          clickLabel: (graph) => {
            const visibleGraphs = graph.chart.graphs.filter((graphObj) => {
              return !graphObj.hidden;
            });
            if (visibleGraphs.length === 1 && !graph.hidden){
              return;
            }
            graph.hidden = !graph.hidden;
            // graph.chart.valueAxes.forEach((valueAxis) => {
            //   valueAxis.guides = this.getZoneGuides();
            // });
            if (!graph.hidden) {
              graph.chart.chartScrollbar = this.getScrollbarForGraph(graph);
            }
            graph.chart.validateNow();
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
        chartScrollbar: this.getScrollbarForGraph(graphs[0]),
        chartCursor: {
          valueZoomable: true,
          categoryBalloonDateFormat: 'JJ:NN:SS',
          cursorAlpha: 0,
          valueLineEnabled: true,
          valueLineBalloonEnabled: true,
          valueLineAlpha: 0.5,
          fullWidth: true
        },
        creditsPosition: 'bottom-right'
      });
      const t1 = performance.now();
      this.logger.d('Created chart after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
      resolve(true);
    });
  }

  private updateChart(): Promise<any> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();

      const dataProvider = this.getDataProvider(this.getDataMap()); // I only need the length @todo
      // This must be called when making any changes to the chart
      this.AmCharts.updateChart(this.chart, () => {
        this.chart.dataProvider = dataProvider;
        this.addListenersToChart();
        this.logger.d('Updated chart after ' +
          (performance.now() - t0) + ' milliseconds or ' +
          (performance.now() - t0) / 1000 + ' seconds'
        );
      });
      resolve(true);
    });
  }

  private addListenersToChart() {
    if (!this.chart.events.rendered.length) {
      this.chart.addListener('rendered', () => {
      });
    }

    if (!this.chart.events.init.length) {
      this.chart.addListener('init', () => {
      });
    }

    if (!this.chart.events.dataUpdated.length) {
      // this.chart.addListener('dataUpdated', (event) => {
      //   event.chart.valueAxes.forEach((valueAxis) => {
      //     valueAxis.guides = this.getZoneGuides();
      //   });
      //   event.chart.validateNow();
      // });
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
      });
    }
  }

  private getAllData(): Map<string, Map<number, DataNumber[]>> {
    const t0 = performance.now();
    if (!this.dataMap) {
      this.dataMap = new Map<string, Map<number, DataNumber[]>>();
      this.selectedActivities.forEach((activity: ActivityInterface, index) => {
        activity.getPointsInterpolated(void 0, void 0).reduce((dataMap: Map<string, Map<number, DataNumber[]>>, point: PointInterface, currentIndex) => {
          point.getData().forEach((pointData: DataInterface, key: string) => {
            if ([DataLatitudeDegrees.type, DataLongitudeDegrees.type].indexOf(key) > -1) {
              return;
            }
            if (!(pointData instanceof DataNumber)) {
              return;
            }
            key += ':' + activity.getID() + ':' + index + ':' + activity.creator.name;
            const DataMapArray = dataMap.get(key) || new Map<number, DataNumber[]>();
            if (!DataMapArray.size) {
              dataMap.set(key, DataMapArray);
            }
            const existingDataArray = DataMapArray.get(point.getDate().getTime()) || [];
            if (!existingDataArray.length) {
              DataMapArray.set(point.getDate().getTime(), existingDataArray)
            }
            existingDataArray.push(pointData);
          });
          return dataMap;
        }, this.dataMap);
      });
    }
    this.logger.d('Retrieved all data after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return this.dataMap;
  }

  private getAllCategoryTypes(): any[] {
    if (this.categories.length < 1) {
      this.getAllData().forEach((dataMapArray, category, eventData) => {
        // Hack here to add the units unfortunately
        this.categories.push({id: category, unit: dataMapArray.values().next().value[0].getUnit()});
      });
    }
    return this.categories;
  }

  private getDataProvider(dataMap: Map<number, any>): any[] {
    const t0 = performance.now();
    const dataProvider = [];
    dataMap.forEach((value: number, key: number) => {
      dataProvider.push(Object.assign({
        date: new Date(key)
      }, value));
    });

    // @todo move this logic to activities or importer
    dataProvider.sort((dataA: any, dataB: any) => {
      return +dataA.date - +dataB.date;
    });

    const t1 = performance.now();
    this.logger.d('Flatten ' + Array.from(dataMap.keys()).length + ' points after ' +
      (t1 - t0) + ' milliseconds or ' +
      (t1 - t0) / 1000 + ' seconds');
    return dataProvider;
  }

  private getDataMap() {
    const t0 = performance.now();
    const dataMap = new Map<number, any>();
    let dataCount = 0;
    this.getAllData().forEach((dataArrayMap: Map<number, DataNumber[]>, dataType: string) => {
      dataArrayMap.forEach((dataArray: DataNumber[], time) => {
        dataArray.reduce((dataAccumulator: Map<number, any>, data: DataNumber) => {
          dataCount++;
          const dateData = dataAccumulator.get(time) || {};
          let value = data.getValue().toFixed(1);
          if (dataType.split(':')[0] === DataHeartRate.type) {
            value = data.getValue().toFixed(0)
          }
          dataAccumulator.set(time, Object.assign(dateData, {
            [dataType]: value,
          }));
          return dataAccumulator;
        }, dataMap);
      })
    });
    const t1 = performance.now();
    this.logger.d('Grouped ' + dataCount + ' data after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
    return dataMap;
  }

  private getValueAxes(): any[] {
    const t0 = performance.now();
    const valueAxes = [];
    let leftIndex = 0;
    let rightIndex = 0;
    this.getAllCategoryTypes().forEach((dataCategory) => {
      valueAxes.push({
        id: dataCategory.id,
        axisColor: this.genColor(dataCategory.id),
        axisThickness: 1,
        axisAlpha: 1,
        position: valueAxes.length % 2 === 0 ? 'left' : 'right',
        offset: valueAxes.length % 2 ? leftIndex * 50 : rightIndex * 50,
        gridThickness: 0.09,
      });
      valueAxes.length % 2 === 0 ? leftIndex++ : rightIndex++;
    });
    this.logger.d('Got valueAxes after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return valueAxes;
  }

  private getGraphs(): any[] {
    const t0 = performance.now();
    const graphs = [];
    this.getAllCategoryTypes().forEach((dataCategory: any) => {
      const categoryID = dataCategory.id;
      const name = categoryID.split(':')[0];
      const activityID = categoryID.split(':')[1];
      const activityIndex = categoryID.split(':')[2];
      const creator = categoryID.split(':')[3];

      graphs.push({
        id: categoryID,
        valueAxis: categoryID,
        lineColor: this.genColor(name + ' ' + (activityIndex > 0 ? activityIndex : '')),
        bulletBorderThickness: 3,
        hideBulletsCount: 1,
        title: '#' + activityIndex + ' ' + name + ' ' + creator,
        valueField: categoryID,
        balloonText: name + '<br><b><span>[[value]] ' + dataCategory.unit + '</span></b></br>' + creator,
        legendValueText: '[[value]] ' + dataCategory.unit,
        fillAlphas: 0.05,
        lineThickness: 1.5,
        useLineColorForBulletBorder: true,
        type: 'line',
        hidden: name !== DataHeartRate.type
      });
    });
    // Check if any is visible and if not make visible the first one
    if (!graphs.find((graph) => {
      return graph.hidden !== true
    })) {
      graphs[0].hidden = false;
    }
    this.logger.d('Got graphs after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return graphs;
  }

  private getZoneGuides() {
    // Find which graphs are visible and if applicable get a zone guide
    if (this.chart.graphs.filter(chart => !chart.hidden).length !== 1) {
      return [];
    }
    return this.chart.graphs.reduce((zoneGuides, graph) => {
      if (graph.hidden) {
        return zoneGuides;
      }

      let units = '';
      // Only for HR for now
      if (graph.id.split(':')[0] === DataHeartRate.type) {
        units = DataHeartRate.unit;
      }

      // Check if there is an intensity zone
      const activityIntensityZones = this.selectedActivities.find((activity: ActivityInterface) => {
        return activity.getID() === graph.id.split(':')[1];
      }).intensityZones.get(graph.id.split(':')[0]);
      if (!activityIntensityZones) {
        return zoneGuides
      }

      zoneGuides.push({
          value: 0,
          toValue: activityIntensityZones.zone2LowerLimit,
          lineAlpha: 0.5,
          lineThickness: 0.5,
          lineColor: '#000000',
          label: 'Z1',
          position: 'right',
          inside: true,
          boldLabel: true,
        }, {
          value: activityIntensityZones.zone2LowerLimit,
          toValue: activityIntensityZones.zone3LowerLimit,
          lineAlpha: 0.5,
          lineThickness: 0.5,
          lineColor: '#000000',
          label: 'Z2 (' + activityIntensityZones.zone2LowerLimit + ' to ' + activityIntensityZones.zone3LowerLimit + ') ' + units,
          position: 'right',
          inside: true,
          boldLabel: true,
        }, {
          value: activityIntensityZones.zone3LowerLimit,
          toValue: activityIntensityZones.zone4LowerLimit,
          lineAlpha: 0.5,
          lineThickness: 0.5,
          lineColor: '#000000',
          label: 'Z3 (' + activityIntensityZones.zone3LowerLimit + ' to ' + activityIntensityZones.zone4LowerLimit + ') ' + units,
          position: 'right',
          inside: true,
          boldLabel: true,
        }, {
          value: activityIntensityZones.zone4LowerLimit,
          toValue: activityIntensityZones.zone5LowerLimit,
          lineAlpha: 0.5,
          lineThickness: 0.5,
          lineColor: '#000000',
          label: 'Z4 (' + activityIntensityZones.zone4LowerLimit + ' to ' + activityIntensityZones.zone5LowerLimit + ') ' + units,
          position: 'right',
          inside: true,
          boldLabel: true,
        },
        {
          value: activityIntensityZones.zone5LowerLimit,
          toValue: 220,
          lineAlpha: 0.5,
          lineThickness: 0.5,
          lineColor: '#000000',
          label: 'Z5 (' + activityIntensityZones.zone5LowerLimit + ' to max) ' + units,
          position: 'right',
          inside: true,
          boldLabel: true,
        }
      );
      return zoneGuides;
    }, []);
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
      offset: 10
    };
  }

  private genColor(key: string) {
    if (key.includes(DataHeartRate.type + ' 4')) {
      return '#006064';
    }
    if (key.includes(DataHeartRate.type + ' 3')) {
      return '#ba68c8';
    }
    if (key.includes(DataHeartRate.type + ' 2')) {
      return '#4ab255';
    }
    if (key.includes(DataHeartRate.type + ' 1')) {
      return '#249fe6';
    }
    if (key.includes(DataHeartRate.type)) {
      return '#ff3f07';
    }
    if (key.includes(DataAltitude.type)) {
      return '#4ab255';
    }
    if (key.includes(DataCadence.type)) {
      return '#5b6979';
    }
    if (key.includes(DataSpeed.type)) {
      return '#2261bf';
    }
    if (key.includes(DataVerticalSpeed.type)) {
      return '#add3c3';
    }
    if (key.includes(DataSeaLevelPressure.type)) {
      return '#889bc8';
    }
    // noinspection TsLint
    return '#' + ('000000' + (Math.random() * 0xFFFFFF << 0).toString(16)).slice(-6);
  }

  ngOnDestroy() {
    // @todo should check better if created or built
    this.AmCharts.destroyChart(this.chart);
  }
}
