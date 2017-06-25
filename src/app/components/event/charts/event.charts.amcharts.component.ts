import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {DataInterface} from '../../../entities/data/data.interface';
import {DataLatitudeDegrees} from '../../../entities/data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../entities/data/data.longitude-degrees';
import seedColor from 'seed-color';
import {EventInterface} from '../../../entities/events/event.interface';
import {AmChartsService} from '@amcharts/amcharts3-angular';
import {DataHeartRate} from '../../../entities/data/data.heart-rate';
import {DataCadence} from '../../../entities/data/data.cadence';
import {DataAltitude} from '../../../entities/data/data.altitude';
import {DataSpeed} from '../../../entities/data/data.speed';
import {DataTemperature} from '../../../entities/data/data.temperature';
import {DataPower} from '../../../entities/data/data.power';
import {DataVerticalSpeed} from '../../../entities/data/data.verticalspeed';
import {DataSeaLevelPressure} from '../../../entities/data/data.sea-level-pressure';

@Component({
  selector: 'app-event-charts-am',
  templateUrl: './event.charts.amcharts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventAmChartsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  private allData: Map<string, DataInterface[]>;
  private dataLength = 0;
  private categories = [];
  private chart: any;
  private waitingForFirstZoom = true;

  constructor(private  changeDetector: ChangeDetectorRef, private AmCharts: AmChartsService) {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
    const t0 = performance.now();
    console.log('OnChanges');

    this.allData = this.event.getData();

    this.createChart().then(() => {
      console.log('Chart create promise completed after ' +
        (performance.now() - t0) + ' milliseconds or ' +
        (performance.now() - t0) / 1000 + ' seconds'
      );
      this.updateChart().then(() => {
        console.log('Chart update promise completed after ' +
          (performance.now() - t0) + ' milliseconds or ' +
          (performance.now() - t0) / 1000 + ' seconds'
        );
      });
    });
  }

  private createChart() {
    const graphs = this.getGraphs();
    const valueAxes = this.getValueAxes();

    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      console.log('Chart Create started after ' +
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
        valueAxes: valueAxes,
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
          // 'autoGridCount': true,
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
      console.log('Created chart after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
      resolve(true);
    });
  }

  private updateChart(startDate?: Date, endDate?: Date, step?: number, prevStep?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();

      this.waitingForFirstZoom = true;

      // @todo should depend on chart width and cache
      step = step || Math.round(this.getAllDataLength() / 500);
      const dataProvider = this.getDataProvider(this.getDataMapSlice(startDate, endDate, step)); // I only need the length @todo

      // This must be called when making any changes to the chart
      this.AmCharts.updateChart(this.chart, () => {
        this.chart.dataProvider = dataProvider;

        if (!this.chart.events.rendered.length) {
          this.chart.addListener('rendered', () => {
            console.log('Chart rendered after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.init.length) {
          this.chart.addListener('init', () => {
            console.log('Chart initialized after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.dataUpdated.length) {
          this.chart.addListener('dataUpdated', () => {
            console.log('Chart data updated after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.resized.length) {
          this.chart.addListener('resized', () => {
            console.log('Chart resized after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds'
            );
          });
        }

        if (!this.chart.events.zoomed.length) {
          this.chart.addListener('zoomed', (event) => {
            console.log('Chart zoomed after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
            if (!this.waitingForFirstZoom) {
              this.updateChart(event.startDate, event.endDate, null);
              // @todo maybe needs first zoom.
              return;
            }
            this.waitingForFirstZoom = false;
          });
        }

        if (!this.chart.events.buildStarted.length) {
          this.chart.addListener('buildStarted', () => {
            console.log('Chart build started after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.changed.length) {
          this.chart.addListener('changed', () => {
            console.log('Chart changed after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.drawn.length) {
          this.chart.addListener('drawn', () => {
            console.log('Chart drawn after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        // debugger;
      });

      console.log('Updated chart after ' +
        (performance.now() - t0) + ' milliseconds or ' +
        (performance.now() - t0) / 1000 + ' seconds'
      );

      resolve(true);
    });

  }

  private getAllData() {
    return this.allData || this.event.getData();
  }

  private getAllCategoryTypes(): any[] {
    if (!this.categories.length) {
      this.getAllData().forEach((dataArray, category, eventData) => {
        this.categories.push(category);
      });
    }
    return this.categories;
  }


  private getAllDataLength(): number {
    if (this.dataLength < 1) {
      this.getAllData().forEach((dataArray, category, eventData) => {
        this.dataLength += dataArray.length;
      });
    }
    return this.dataLength;
  }

  private getDataProvider(dataMap: Map<string, any>): any[] {
    const t0 = performance.now();
    const dataProvider = [];
    let categoryCount = 0;
    dataMap.forEach((value: number, key: string) => {
      categoryCount++;
      dataProvider.push(Object.assign({
        date: key
      }, value));
    });

    const t1 = performance.now();
    console.log('Flatten ' + categoryCount + ' categories of data after ' +
      (t1 - t0) + ' milliseconds or ' +
      (t1 - t0) / 1000 + ' seconds');
    return dataProvider;
  }

  private getDataMapSlice(startDate?: Date, endDate?: Date, step?: number) {
    const t0 = performance.now();
    const dataMap = new Map<string, any>();
    let dataCount = 0;
    this.event.getData(startDate, endDate, step).forEach((dataArray: DataInterface[], dataType: string) => {
      if ([DataLatitudeDegrees.name, DataLongitudeDegrees.name].indexOf(dataType) > -1) {
        return;
      }

      dataArray.reduce((dataAccumulator: Map<string, any>, data: DataInterface, currentIndex) => {
        dataCount++;
        const dateData = dataAccumulator.get(data.getPoint().getDate().toISOString()) || {};
        dataAccumulator.set(data.getPoint().getDate().toISOString(), Object.assign(dateData, {
          [data.constructor.name]: data.getValue().toFixed(1)
        }));
        return dataAccumulator;
      }, dataMap);

    });
    const t1 = performance.now();
    console.log('Grouped ' + dataCount + ' data after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
    return dataMap;
  }

  private getValueAxes(): any[] {
    const t0 = performance.now();
    const valueAxes = [];
    let leftIndex = 0;
    let rightIndex = 0;
    this.getAllCategoryTypes().forEach((dataCategory) => {
      if ([DataLatitudeDegrees.name, DataLongitudeDegrees.name].indexOf(dataCategory) > -1) {
        return;
      }
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
    console.log('Got valueAxes after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return valueAxes;
  }

  private getGraphs(): any[] {
    const t0 = performance.now();
    const graphs = [];
    this.getAllCategoryTypes().forEach((dataCategory: string) => {
      if ([DataLatitudeDegrees.name, DataLongitudeDegrees.name].indexOf(dataCategory) > -1) {
        return;
      }
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
        negativeLineColor: this.genColor(dataCategory + 'negativeLineColor'),
        type: 'line',
        hidden: graphs.length > 0
      });
    });
    console.log('Got graphs after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return graphs;
  }

   private genColor(key: string) {
    // @todo remove this crappy lib
    switch (key) {
      case DataHeartRate.name: return '#ff3f07';
      case DataAltitude.name: return '#3d9339';
      case DataCadence.name: return '#5b6979';
      case DataSpeed.name: return '#2261bf';
      case DataVerticalSpeed.name: return '#d38e2e';
      case DataTemperature.name: return '#407677';
      case DataPower.name: return '#d38e2e';
      case DataSeaLevelPressure.name: return '#b0d8cf';
    }
    return seedColor(key).toHex();
  }

  ngOnDestroy() {
    this.AmCharts.destroyChart(this.chart);
  }
}
