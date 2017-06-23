import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit,
} from '@angular/core';
import {DataInterface} from '../../../entities/data/data.interface';
import {DataLatitudeDegrees} from '../../../entities/data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../entities/data/data.longitude-degrees';
import seedColor from 'seed-color';
import {EventInterface} from '../../../entities/events/event.interface';
import {AmChartsService} from '@amcharts/amcharts3-angular';
import {DataHeartRate} from "../../../entities/data/data.heart-rate";
import {DataCadence} from "../../../entities/data/data.cadence";
import {DataAltitude} from "../../../entities/data/data.altitude";
import {DataSpeed} from "../../../entities/data/data.speed";
import {DataTemperature} from "../../../entities/data/data.temperature";
import {DataPower} from "../../../entities/data/data.power";
import {DataVerticalSpeed} from "../../../entities/data/data.verticalspeed";
import {DataSeaLevelPressure} from "../../../entities/data/data.sea-level-pressure";

@Component({
  selector: 'app-event-charts-am',
  templateUrl: './event.charts.amcharts.component.html',
  // changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventAmChartsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  private chart: any;

  constructor(private  changeDetector: ChangeDetectorRef, private AmCharts: AmChartsService) {
  }

  ngOnInit() {
  }

  ngOnChanges(): void {
    console.log('OnChanges');
    this.createChart().then(() => {
      //this.updateChart();
    });
  }

  private createChart(): Promise<any> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      if (this.chart) {
        this.AmCharts.destroyChart(this.chart);
      }
      this.chart = this.AmCharts.makeChart('chartdiv', {
        type: 'serial',
        theme: 'light',
        graphs: this.getGraphs(),
        valueAxes: this.getValueAxes(),
        dataProvider: this.getData(),
        startDuration: 1,
        startEffect: 'elastic',
        sequencedAnimation: false,
        categoryField: 'date',
        processTimeout: 1,
        processCount: 10,
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
          graphType: 'line',
          graph: this.getGraphs()[0].id,
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
      });
      const t1 = performance.now();
      console.log('Created chart after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
      resolve(true);
    });
  }

  private updateChart(): Promise<any> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      // This must be called when making any changes to the chart
      this.AmCharts.updateChart(this.chart, () => {
        this.chart.graphs = this.getGraphs();
        this.chart.valueAxes = this.getValueAxes();
        this.chart.dataProvider = this.getData();

        // Change whatever properties you want, add event listeners, etc.
        this.chart.addListener('rendered', () => {
          this.chart.zoomOut();
          this.chart.invalidateSize();
          const t1 = performance.now();
          console.log('Chart rendered after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
        });

        this.chart.addListener('init', () => {
          // debugger;
        });
        this.chart.addListener('dataUpdated', () => {
        });
        // debugger;
      });
      const t1 = performance.now();
      console.log('Updated chart after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
      resolve(true);
    });

  }

  private getData(): any[] {
    const t0 = performance.now();
    const dataMap = new Map<string, any>();
    const graphData = [];
    this.event.getData().forEach((dataArray: DataInterface[], key: string, map) => {

      if ([DataLatitudeDegrees.name, DataLongitudeDegrees.name].indexOf(key) > -1) {
        return;
      }

      dataArray.reduce((dataAccumulator: Map<string, any>, data: DataInterface, currentIndex) => {
        const dateData = dataAccumulator.get(data.getPoint().getDate().toISOString()) || {};
        dataAccumulator.set(data.getPoint().getDate().toISOString(), Object.assign(dateData, {
          [data.constructor.name]: data.getValue().toFixed(1)
        }));
        return dataAccumulator;
      }, dataMap);

    });

    dataMap.forEach((value, key, map) => {
      graphData.push(Object.assign({
        date: key
      }, value));
    });

    const t1 = performance.now();
    console.log('Formatted data after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');
    return graphData;
  }

  private getValueAxes(): any[] {
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
        precision: 0,
      });
      valueAxes.length % 2 === 0 ? leftIndex++ : rightIndex++;
    });
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
        minDistance: dataArray.length / 1000,
        negativeLineColor: this.genColor(key + 'negativeLineColor'),
        type: 'line',
      });
    });
    return graphs;
  }


  ngOnDestroy() {
    this.AmCharts.destroyChart(this.chart);
  }
}
