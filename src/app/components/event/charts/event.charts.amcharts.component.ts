import {
  AfterContentInit,
  ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, ViewChild,
} from '@angular/core';
import {DataInterface} from '../../../entities/data/data.interface';
import {DataLatitudeDegrees} from '../../../entities/data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../entities/data/data.longitude-degrees';
import seedColor from 'seed-color';
import {EventInterface} from '../../../entities/events/event.interface';
import {AmChartsService} from '@amcharts/amcharts3-angular';
import {debug} from 'util';
import {DataHeartRate} from '../../../entities/data/data.heart-rate';

@Component({
  selector: 'app-event-charts-am',
  templateUrl: './event.charts.amcharts.component.html',
})
export class EventAmChartsComponent implements OnChanges, OnInit, OnDestroy {

  @Input() event: EventInterface;

  private chart: any;

  constructor(private  changeDetector: ChangeDetectorRef, private AmCharts: AmChartsService) {
  }

  ngOnInit() {
    console.log('OnInit');
    if (this.chart) {
      return;
    }
    this.createChart().then(() => {
      this.updateChart();
    });
  }

  ngOnChanges(): void {
    console.log('OnChanges');
    if (this.chart) {
      this.updateChart();
    }
  }

  private createChart(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.chart = this.AmCharts.makeChart('chartdiv', {
        type: 'serial',
        theme: 'light',
        startDuration: 1,
        startEffect: 'easeInSine',
        sequencedAnimation: false,
        categoryField: 'date',
        legend: {
          useGraphSettings: true,
          autoMargins: false,
          marginTop: 10,
        },
        synchronizeGrid: true,
        categoryAxis: {
          parseDates: true,
          minPeriod: 'fff',
          axisColor: '#DADADA',
          gridThickness: 0.1,
          offset: 0,
          labelOffset: 10,
          minorGridEnabled: true,
        },
        chartScrollbar: {
          graph: DataHeartRate.name,
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
          usePeriod: 'WW'
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

        });

        this.chart.addListener('init', () => {
          // debugger;
        });
        this.chart.addListener('dataUpdated', () => {
          // debugger;
        });
        // debugger;
      });
      const t1 = performance.now();
      console.log('Created chart after ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');

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
          [data.constructor.name]: Number(data.getValue()).toFixed(1)
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
        offset: valueAxes.length && valueAxes.length % 2 === 0 ? (valueAxes.length - 1) / 2 * 80 : 0,
        gridThickness: 0.09,
      });
    });
    return valueAxes;
  }

  private genColor(key: string) {
    // @todo remove this crappy lib
    return seedColor(key.slice(0)).toHex();
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
        balloonText: key + '<br><b><span style=\'font-size:14px;\'>[[value]]</span></b>',
        fillAlphas: 0.05,
        bulletSize: 3,
        lineThickness: 1.2,
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
