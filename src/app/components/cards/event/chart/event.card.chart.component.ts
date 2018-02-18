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
import {DataVerticalSpeed} from '../../../../entities/data/data.verticalspeed';
import {DataSeaLevelPressure} from '../../../../entities/data/data.sea-level-pressure';
import {Log, Level} from 'ng2-logger'
import {ActivityInterface} from '../../../../entities/activities/activity.interface';
import {PointInterface} from '../../../../entities/points/point.interface';


@Component({
  selector: 'app-event-card-chart',
  templateUrl: './event.card.chart.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventCardChartComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  private dataMap: Map<string, DataInterface[]>;
  private categories = [];
  private chart: any;
  private logger = Log.create('EventCardChartComponent');

  constructor(private  changeDetector: ChangeDetectorRef, private AmCharts: AmChartsService) {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
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
        graphs: graphs,
        // autoTransform: false,
        // autoResize: false,
        // autoDisplay: false,
        // responsive: {
        //   enabled: false
        // },
        // valueAxes: valueAxes,
        startDuration: 1,
        startEffect: 'elastic',
        sequencedAnimation: false,
        categoryField: 'date',
        processCount: 1000,
        legend: {
          align: 'center',
          useGraphSettings: true,
          autoMargins: true,
          marginTop: 0,
          valueText: '[[value]]'
        },
        synchronizeGrid: true,
        categoryAxis: {
          parseDates: true,
          minPeriod: 'fff',
          axisColor: '#DADADA',
          gridThickness: 0.1,
          offset: 0,
          labelOffset: 0,
          minorGridEnabled: true,
        },
        chartScrollbar: {
          hideResizeGrips: true,
          autoGridCount: true,
          graphType: 'line',
          graph: graphs[0].id,
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
        },
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

  private updateChart(startDate?: Date, endDate?: Date, step?: number, prevStep?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();

      const dataProvider = this.getDataProvider(this.getDataMapSlice(startDate, endDate, step)); // I only need the length @todo
      // This must be called when making any changes to the chart
      this.AmCharts.updateChart(this.chart, () => {
        this.chart.dataProvider = dataProvider;

        if (!this.chart.events.rendered.length) {
          this.chart.addListener('rendered', () => {
            this.logger.d('Chart rendered after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.init.length) {
          this.chart.addListener('init', () => {
            this.logger.d('Chart initialized after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.dataUpdated.length) {
          this.chart.addListener('dataUpdated', () => {
            this.logger.d('Chart data updated after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.resized.length) {
          this.chart.addListener('resized', () => {
            this.logger.d('Chart resized after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.zoomed.length) {
          this.chart.addListener('zoomed', (event) => {
            this.logger.d('Chart zoomed after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.buildStarted.length) {
          this.chart.addListener('buildStarted', () => {
            this.logger.d('Chart build started after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.changed.length) {
          this.chart.addListener('changed', () => {
            this.logger.d('Chart changed after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.drawn.length) {
          this.chart.addListener('drawn', () => {
            this.logger.d('Chart drawn after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

      });

      this.logger.d('Updated chart after ' +
        (performance.now() - t0) + ' milliseconds or ' +
        (performance.now() - t0) / 1000 + ' seconds'
      );

      resolve(true);
    });
  }

  private getAllData(): Map<string, DataInterface[]> {
    const t0 = performance.now();
    if (!this.dataMap) {
      this.dataMap = new Map<string, DataInterface[]>();
      this.event.getActivities().forEach((activity: ActivityInterface, index) => {
        activity.getPoints(void 0, void 0, 1).reduce((dataMap: Map<string, DataInterface[]>, point: PointInterface, currentIndex) => {
          point.getData().forEach((pointDataArray: DataInterface[], key: string) => {
            if ([DataLatitudeDegrees.type, DataLongitudeDegrees.type].indexOf(key) > -1) {
              return;
            }
            const existingDataArray = dataMap.get(key + (index ? ' ' + String(index) : '')) || [];
            if (!existingDataArray.length) {
              dataMap.set(key + (index ? ' ' + String(index) : ''), existingDataArray);
            }
            pointDataArray.forEach((pointData) => {
              existingDataArray.push(pointData)
            });
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
      this.getAllData().forEach((dataArray, category, eventData) => {
        this.categories.push(category);
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

  private getDataMapSlice(startDate?: Date, endDate?: Date, step?: number) {
    const t0 = performance.now();
    const dataMap = new Map<number, any>();
    let dataCount = 0;
    this.getAllData().forEach((dataArray: DataInterface[], dataType: string) => {
      dataArray.reduce((dataAccumulator: Map<number, any>, data: DataInterface) => {
        dataCount++;
        const dateData = dataAccumulator.get(data.getPoint().getDate().getTime()) || {};
        dataAccumulator.set(data.getPoint().getDate().getTime(), Object.assign(dateData, {
          [dataType]: data.getValue().toFixed(1)
        }));
        return dataAccumulator;
      }, dataMap);

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
        id: dataCategory,
        axisColor: this.genColor(dataCategory),
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
    this.getAllCategoryTypes().forEach((dataCategory: string) => {
      graphs.push({
        id: dataCategory,
        valueAxis: dataCategory,
        lineColor: this.genColor(dataCategory),
        bulletBorderThickness: 3,
        hideBulletsCount: 1,
        title: dataCategory,
        valueField: dataCategory,
        balloonText: dataCategory + '<br><b><span>[[value]]</span></b>',
        fillAlphas: 0.1,
        lineThickness: 1.4,
        useLineColorForBulletBorder: true,
        bulletBorderAlpha: 1,
        bulletColor: '#FFFFFF',
        type: 'line',
        hidden: graphs.length > 3
      });
    });
    this.logger.d('Got graphs after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return graphs;
  }

  private genColor(key: string) {
    if (key.includes(DataHeartRate.type)) { return '#ff3f07'; }
    if (key.includes(DataAltitude.type)) { return '#4ab255'; }
    if (key.includes(DataCadence.type)) { return '#5b6979'; }
    if (key.includes(DataSpeed.type)) { return '#2261bf'; }
    if (key.includes(DataVerticalSpeed.type)) { return '#add3c3'; }
    if (key.includes(DataSeaLevelPressure.type)) { return '#889bc8'; }
    // noinspection TsLint
    return '#' + ('000000' + (Math.random() * 0xFFFFFF << 0).toString(16)).slice(-6);
  }

  ngOnDestroy() {
    this.AmCharts.destroyChart(this.chart);
  }
}
