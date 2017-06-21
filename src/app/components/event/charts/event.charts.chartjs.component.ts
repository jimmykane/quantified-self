import {
  ChangeDetectorRef, Component, Input, OnChanges, OnInit,
  ViewChild
} from '@angular/core';
import {DataInterface} from '../../../entities/data/data.interface';
import {BaseChartDirective} from 'ng2-charts';
import {DataLatitudeDegrees} from '../../../entities/data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../../../entities/data/data.longitude-degrees';
import seedColor from 'seed-color';
import {EventInterface} from '../../../entities/events/event.interface';

@Component({
  selector: 'app-event-charts-js',
  templateUrl: './event.charts.chartjs.component.html',
})
export class EventChartsChartJSComponent implements OnChanges, OnInit {
  @Input() event: EventInterface;
  @ViewChild(BaseChartDirective) childCmpBaseChartRef: any;

  lineChartData: any[] = [];

  lineChartLabels: any = [];

  lineChartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      xAxes: [{
        type: 'time',
        display: true,
        scaleLabel: {
          display: true,
          labelString: 'Date'
        }
      }],
      yAxes: [{
        display: true,
        scaleLabel: {
          display: true,
          labelString: 'value'
        }
      }]
    },

    elements: {
      point: {
        radius: 1
      }
    }


  };
  public lineChartColors: Array<any> = [
    // { // grey
    //   backgroundColor: 'rgba(148,159,177,0.2)',
    //   borderColor: 'rgba(148,159,177,1)',
    //   pointBackgroundColor: 'rgba(148,159,177,1)',
    //   pointBorderColor: '#fff',
    //   pointHoverBackgroundColor: '#fff',
    //   pointHoverBorderColor: 'rgba(148,159,177,0.8)'
    // },
    // { // dark grey
    //   backgroundColor: 'rgba(77,83,96,0.2)',
    //   borderColor: 'rgba(77,83,96,1)',
    //   pointBackgroundColor: 'rgba(77,83,96,1)',
    //   pointBorderColor: '#fff',
    //   pointHoverBackgroundColor: '#fff',
    //   pointHoverBorderColor: 'rgba(77,83,96,1)'
    // },
    // { // grey
    //   backgroundColor: 'rgba(148,159,177,0.2)',
    //   borderColor: 'rgba(148,159,177,1)',
    //   pointBackgroundColor: 'rgba(148,159,177,1)',
    //   pointBorderColor: '#fff',
    //   pointHoverBackgroundColor: '#fff',
    //   pointHoverBorderColor: 'rgba(148,159,177,0.8)'
    // }
  ];

  public lineChartLegend = true;
  public lineChartType = 'line';

  constructor(private  changeDetector: ChangeDetectorRef) {
    // this.changeDetector.detach();

  }

  ngOnInit() {
    // this.formatData();
  }

  ngOnChanges(): void {
    this.formatData();
  }

  private formatData() {
    this.lineChartData = [];
    const t0 = performance.now();

    this.event.getData().forEach((dataArray: DataInterface[], key: string, map) => {
      if ([DataLatitudeDegrees.name, DataLongitudeDegrees.name].indexOf(key) > -1) {
        return;
      }

      let dataSet = this.lineChartData.find((lineChartDataDataSet) => {
        return lineChartDataDataSet.label === key;
      });

      if (!dataSet) {
        dataSet = {
          label: key,
          borderColor: this.getBorderColorForDataType(key),
          data: []
        };
        this.lineChartData.push(dataSet);
      }


      dataArray.reduce((dataAccumulator: any[], data: DataInterface, currentIndex) => {
        if (currentIndex % 20 === 0) {
          dataAccumulator.push({
            x: data.getPoint().getDate(),
            y: Number(data.getValue())
          });
        }
        return dataAccumulator;
      }, dataSet.data);
    });

    const t1 = performance.now();
    console.log('Call to doSomething took ' + (t1 - t0) + ' milliseconds or ' + (t1 - t0) / 1000 + ' seconds');

    // see https://github.com/valor-software/ng2-charts/issues/666
    if (this.childCmpBaseChartRef.datasets && this.childCmpBaseChartRef.datasets.length !== this.lineChartData.length) {
      this.childCmpBaseChartRef.datasets = this.lineChartData;
      this.childCmpBaseChartRef.ngOnInit();
    }
  }

  private getBorderColorForDataType(dataType: string, alpha?: number): string {
    alpha = alpha || 1;
    const color = seedColor((dataType).slice(4));
    return 'rgba(' + color.rgb.concat(alpha).join(',') + ')';
  }
}
