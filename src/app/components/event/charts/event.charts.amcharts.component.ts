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
  // changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventAmChartsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;


  private chart: any;
  private waitingForFirstZoom = true;

  constructor(private  changeDetector: ChangeDetectorRef, private AmCharts: AmChartsService) {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
    console.log('OnChanges');
    this.createChart().then(() => {
      this.updateChart();
    });
  }

  private createChart(): Promise<any> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const graphs = this.getGraphs();
      const valueAxes = this.getValueAxes();
      if (this.chart) {
        this.AmCharts.destroyChart(this.chart);
      }
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


      startDate = startDate || this.event.getFirstActivity().getStartDate();
      endDate = endDate || this.event.getLastActivity().getEndDate();
      // @todo should depend on chart width
      step = step || Math.round(this.getData(startDate, endDate).length / 500); // @todo check round and make width dynamic
      const data = this.getData(startDate, endDate, step); // I only need the length @todo

      // This must be called when making any changes to the chart
      this.AmCharts.updateChart(this.chart, () => {
        this.chart.dataProvider = data;


        if (!this.chart.events.rendered.length) {
          this.chart.addListener('rendered', () => {
            // this.chart.zoomOut();
            // this.chart.invalidateSize();
            console.log('Chart rendered after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.init.length) {
          this.chart.addListener('init', () => {
            console.log('Chart initialized after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.dataUpdated.length) {
          this.chart.addListener('dataUpdated', () => {
            console.log('Chart data updated after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.resized.length) {
          this.chart.addListener('resized', () => {
            console.log('Chart resized after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
          });
        }

        if (!this.chart.events.zoomed.length) {
          this.chart.addListener('zoomed', (event) => {
            console.log('Chart zoomed after ' +
              (performance.now() - t0) + ' milliseconds or ' +
              (performance.now() - t0) / 1000 + ' seconds');
            if (!this.waitingForFirstZoom) {
              debugger;
              this.updateChart(event.startDate, event.endDate);
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

  private getData(startDate?: Date, endDate?: Date, step?: number): any[] {
    const t0 = performance.now();
    const dataMap = new Map<string, any>();
    const graphData = [];
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

    dataMap.forEach((value: number, key: string) => {
      graphData.push(Object.assign({
        date: key
      }, value));
    });

    const t1 = performance.now();
    console.log('Formatted ' + dataCount + ' data after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
    return graphData;
  }

  private getValueAxes(): any[] {
    const t0 = performance.now();
    const valueAxes = [];
    let leftIndex = 0;
    let rightIndex = 0;
    this.event.getData().forEach((dataArray: DataInterface[], key: string, map) => {
      if ([DataLatitudeDegrees.name, DataLongitudeDegrees.name].indexOf(key) > -1) {
        return;
      }
      valueAxes.push({
        id: key,
        axisColor: this.genColor(key),
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

  private getGraphs(): any[] {
    const t0 = performance.now();
    const graphs = [];
    this.event.getData().forEach((dataArray: DataInterface[], key: string, map) => {
      if ([DataLatitudeDegrees.name, DataLongitudeDegrees.name].indexOf(key) > -1) {
        return;
      }
      graphs.push({
        id: key,
        valueAxis: key,
        lineColor: this.genColor(key),
        bulletBorderThickness: 3,
        hideBulletsCount: 1,
        title: key,
        valueField: key,
        balloonText: key + '<br><b><span>[[value]]</span></b>',
        fillAlphas: 0.1,
        lineThickness: 1.4,
        useLineColorForBulletBorder: true,
        bulletBorderAlpha: 1,
        bulletColor: '#FFFFFF',
        negativeLineColor: this.genColor(key + 'negativeLineColor'),
        type: 'line',
        hidden: graphs.length > 0
      });
    });
    console.log('Got valueAxes after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return graphs;
  }

  ngOnDestroy() {
    this.AmCharts.destroyChart(this.chart);
  }
}
