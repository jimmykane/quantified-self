import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
} from '@angular/core';
import { Log } from 'ng2-logger/browser'
import * as am4charts from '@amcharts/amcharts4/charts';
import { EventColorService } from '../../../services/color/app.event.color.service';
import { ChartAbstractDirective } from '../../charts/chart-abstract.directive';
import { LinearGradient } from '@amcharts/amcharts4/core';
import { Subscription, timer } from 'rxjs';
import { take } from 'rxjs/operators';
import { LineSeriesDataItem } from '@amcharts/amcharts4/charts';


@Component({
  selector: 'app-home-live-chart',
  templateUrl: './home.live-chart.component.html',
  styleUrls: ['./home.live-chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeLiveChartComponent extends ChartAbstractDirective implements OnDestroy, AfterViewInit {

  protected logger = Log.create('HomeLiveChartComponent');
  protected liveDataSubscription: Subscription;

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected eventColorService: EventColorService) {
    super(zone, changeDetector);
  }

  ngAfterViewInit(): void {
    this.chart = this.createChart();
    this.subscribeToLiveData();
  }



  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);
    // Disable the preloader
    chart.preloader.disabled = true;
    // chart.exporting.menu = this.getExportingMenu();
    chart.hiddenState.properties.opacity = 0;
    chart.padding(10, 0, 0, 1);
    chart.fontSize = '0.8em';


    chart.zoomOutButton.disabled = true;

    chart.data = this.getInitialData();

    const dateAxis = chart.xAxes.push(new am4charts.DateAxis());
    dateAxis.renderer.grid.template.location = 0;
    dateAxis.renderer.minGridDistance = 30;
    dateAxis.dateFormats.setKey('second', 'ss');
    dateAxis.periodChangeDateFormats.setKey('second', '[bold]h:mm a');
    dateAxis.periodChangeDateFormats.setKey('minute', '[bold]h:mm a');
    dateAxis.periodChangeDateFormats.setKey('hour', '[bold]h:mm a');
    dateAxis.renderer.inside = true;
    dateAxis.renderer.axisFills.template.disabled = true;
    dateAxis.renderer.ticks.template.disabled = true;

    const valueAxis = chart.yAxes.push(new am4charts.ValueAxis());
    valueAxis.tooltip.disabled = true;
    valueAxis.interpolationDuration = 500;
    valueAxis.rangeChangeDuration = 500;
    valueAxis.renderer.inside = true;
    valueAxis.renderer.minLabelPosition = 0.05;
    valueAxis.renderer.maxLabelPosition = 0.95;
    valueAxis.renderer.axisFills.template.disabled = true;
    valueAxis.renderer.ticks.template.disabled = true;

    const series = chart.series.push(new am4charts.LineSeries());
    series.dataFields.dateX = 'date';
    series.dataFields.valueY = 'value';
    series.interpolationDuration = 500;
    series.defaultState.transitionDuration = 0;
    series.tensionX = 0.8;

    chart.events.on('datavalidated', function () {
      dateAxis.zoom({ start: 1 / 15, end: 1.2 }, false, true);
    });

    dateAxis.interpolationDuration = 500;
    dateAxis.rangeChangeDuration = 500;

    series.fillOpacity = 1;
    const gradient = new LinearGradient();
    gradient.addColor(chart.colors.getIndex(0), 0.2);
    gradient.addColor(chart.colors.getIndex(0), 0);
    series.fill = gradient;
    this.logger.info(`Chart created `)

    return chart;
  }

  private getInitialData(): { date: number, value: number }[] {
    const now = new Date();
    
    return [
      {
        "date": 0,
        "value": 144
      },
      {
        "date": 3,
        "value": 143
      },
      {
        "date": 7,
        "value": 144
      },
      {
        "date": 10,
        "value": 144
      },
      {
        "date": 13,
        "value": 145
      },
      {
        "date": 16,
        "value": 146
      },
      {
        "date": 18,
        "value": 144
      },
      {
        "date": 21,
        "value": 143
      },
      {
        "date": 24,
        "value": 143
      },
      {
        "date": 26,
        "value": 144
      },
      {
        "date": 28,
        "value": 144
      },
      {
        "date": 31,
        "value": 145
      },
      {
        "date": 34,
        "value": 143
      },
      {
        "date": 35,
        "value": 145
      },
      {
        "date": 37,
        "value": 145
      },
      {
        "date": 39,
        "value": 143
      },
      {
        "date": 42,
        "value": 144
      },
      {
        "date": 44,
        "value": 142
      },
      {
        "date": 47,
        "value": 143
      },
      {
        "date": 49,
        "value": 142
      },
      {
        "date": 51,
        "value": 144
      },
      {
        "date": 53,
        "value": 143
      },
      {
        "date": 55,
        "value": 145
      },
      {
        "date": 57,
        "value": 144
      },
      {
        "date": 60,
        "value": 143
      },
      {
        "date": 62,
        "value": 144
      },
      {
        "date": 65,
        "value": 144
      },
      {
        "date": 68,
        "value": 144
      },
      {
        "date": 70,
        "value": 145
      },
      {
        "date": 72,
        "value": 144
      },
      {
        "date": 74,
        "value": 146
      },
      {
        "date": 76,
        "value": 147
      },
      {
        "date": 78,
        "value": 146
      },
      {
        "date": 80,
        "value": 147
      },
      {
        "date": 82,
        "value": 148
      },
      {
        "date": 85,
        "value": 147
      },
      {
        "date": 87,
        "value": 149
      },
      {
        "date": 89,
        "value": 149
      },
      {
        "date": 91,
        "value": 149
      },
      {
        "date": 93,
        "value": 151
      },
      {
        "date": 95,
        "value": 151
      },
      {
        "date": 97,
        "value": 151
      },
      {
        "date": 99,
        "value": 151
      },
      {
        "date": 101,
        "value": 153
      },
      {
        "date": 104,
        "value": 153
      },
      {
        "date": 106,
        "value": 151
      },
      {
        "date": 108,
        "value": 154
      },
      {
        "date": 110,
        "value": 154
      },
      {
        "date": 113,
        "value": 154
      },
      {
        "date": 115,
        "value": 153
      },
      {
        "date": 117,
        "value": 155
      },
      {
        "date": 119,
        "value": 156
      },
      {
        "date": 121,
        "value": 156
      },
      {
        "date": 123,
        "value": 155
      },
      {
        "date": 125,
        "value": 155
      },
      {
        "date": 127,
        "value": 155
      },
      {
        "date": 129,
        "value": 156
      },
      {
        "date": 131,
        "value": 155
      },
      {
        "date": 133,
        "value": 155
      },
      {
        "date": 135,
        "value": 155
      },
      {
        "date": 137,
        "value": 156
      },
      {
        "date": 139,
        "value": 157
      },
      {
        "date": 142,
        "value": 156
      },
      {
        "date": 145,
        "value": 157
      },
      {
        "date": 148,
        "value": 156
      },
      {
        "date": 150,
        "value": 155
      },
      {
        "date": 152,
        "value": 157
      },
      {
        "date": 154,
        "value": 157
      },
      {
        "date": 156,
        "value": 157
      },
      {
        "date": 158,
        "value": 156
      },
      {
        "date": 160,
        "value": 156
      },
      {
        "date": 162,
        "value": 157
      },
      {
        "date": 164,
        "value": 158
      },
      {
        "date": 167,
        "value": 158
      },
      {
        "date": 169,
        "value": 157
      },
      {
        "date": 171,
        "value": 158
      },
      {
        "date": 173,
        "value": 157
      },
      {
        "date": 176,
        "value": 157
      },
      {
        "date": 178,
        "value": 158
      },
      {
        "date": 180,
        "value": 159
      },
      {
        "date": 184,
        "value": 160
      },
      {
        "date": 186,
        "value": 158
      },
      {
        "date": 188,
        "value": 158
      },
      {
        "date": 193,
        "value": 158
      },
      {
        "date": 196,
        "value": 159
      },
      {
        "date": 198,
        "value": 159
      },
      {
        "date": 200,
        "value": 159
      },
      {
        "date": 202,
        "value": 159
      },
      {
        "date": 204,
        "value": 160
      },
      {
        "date": 206,
        "value": 159
      },
      {
        "date": 208,
        "value": 158
      },
      {
        "date": 210,
        "value": 159
      },
      {
        "date": 213,
        "value": 160
      },
      {
        "date": 215,
        "value": 159
      },
      {
        "date": 217,
        "value": 160
      },
      {
        "date": 219,
        "value": 158
      },
      {
        "date": 221,
        "value": 158
      },
      {
        "date": 223,
        "value": 157
      },
      {
        "date": 225,
        "value": 158
      },
      {
        "date": 228,
        "value": 159
      },
      {
        "date": 230,
        "value": 158
      },
      {
        "date": 232,
        "value": 158
      },
      {
        "date": 234,
        "value": 155
      },
      {
        "date": 236,
        "value": 155
      },
      {
        "date": 238,
        "value": 157
      },
      {
        "date": 241,
        "value": 157
      },
      {
        "date": 244,
        "value": 156
      },
      {
        "date": 247,
        "value": 157
      },
      {
        "date": 250,
        "value": 157
      },
      {
        "date": 252,
        "value": 156
      },
      {
        "date": 255,
        "value": 155
      },
      {
        "date": 257,
        "value": 155
      },
      {
        "date": 262,
        "value": 153
      },
      {
        "date": 264,
        "value": 153
      },
      {
        "date": 266,
        "value": 152
      },
      {
        "date": 271,
        "value": 153
      },
      {
        "date": 274,
        "value": 153
      },
      {
        "date": 277,
        "value": 152
      },
      {
        "date": 280,
        "value": 153
      },
      {
        "date": 283,
        "value": 152
      },
      {
        "date": 286,
        "value": 151
      },
      {
        "date": 289,
        "value": 153
      },
      {
        "date": 292,
        "value": 154
      },
      {
        "date": 295,
        "value": 154
      },
      {
        "date": 298,
        "value": 153
      },
      {
        "date": 300,
        "value": 155
      },
      {
        "date": 303,
        "value": 155
      },
      {
        "date": 306,
        "value": 153
      },
      {
        "date": 310,
        "value": 152
      },
      {
        "date": 314,
        "value": 153
      },
      {
        "date": 321,
        "value": 152
      },
      {
        "date": 325,
        "value": 153
      },
      {
        "date": 333,
        "value": 153
      },
      {
        "date": 337,
        "value": 154
      },
      {
        "date": 340,
        "value": 154
      },
      {
        "date": 343,
        "value": 152
      },
      {
        "date": 346,
        "value": 153
      },
      {
        "date": 350,
        "value": 154
      },
      {
        "date": 353,
        "value": 152
      },
      {
        "date": 356,
        "value": 152
      },
      {
        "date": 360,
        "value": 153
      },
      {
        "date": 364,
        "value": 153
      },
      {
        "date": 367,
        "value": 151
      },
      {
        "date": 370,
        "value": 151
      },
      {
        "date": 373,
        "value": 150
      },
      {
        "date": 375,
        "value": 150
      },
      {
        "date": 378,
        "value": 149
      },
      {
        "date": 381,
        "value": 147
      },
      {
        "date": 384,
        "value": 148
      },
      {
        "date": 388,
        "value": 148
      },
      {
        "date": 391,
        "value": 147
      },
      {
        "date": 394,
        "value": 147
      },
      {
        "date": 397,
        "value": 144
      },
      {
        "date": 400,
        "value": 144
      },
      {
        "date": 404,
        "value": 143
      },
      {
        "date": 407,
        "value": 142
      },
      {
        "date": 410,
        "value": 140
      },
      {
        "date": 414,
        "value": 140
      },
      {
        "date": 418,
        "value": 139
      },
      {
        "date": 422,
        "value": 139
      },
      {
        "date": 426,
        "value": 139
      },
      {
        "date": 429,
        "value": 139
      },
      {
        "date": 432,
        "value": 140
      },
      {
        "date": 436,
        "value": 141
      },
      {
        "date": 439,
        "value": 138
      },
      {
        "date": 443,
        "value": 140
      },
      {
        "date": 447,
        "value": 140
      },
      {
        "date": 451,
        "value": 139
      },
      {
        "date": 455,
        "value": 139
      },
      {
        "date": 459,
        "value": 138
      },
      {
        "date": 463,
        "value": 139
      },
      {
        "date": 467,
        "value": 138
      },
      {
        "date": 470,
        "value": 138
      },
      {
        "date": 474,
        "value": 139
      },
      {
        "date": 478,
        "value": 139
      },
      {
        "date": 481,
        "value": 139
      },
      {
        "date": 484,
        "value": 138
      },
      {
        "date": 487,
        "value": 138
      }
    ]
  }

  private subscribeToLiveData(){
    this.liveDataSubscription = timer(1000, 1000).pipe().subscribe(x=>{
      const lastdataItem = <LineSeriesDataItem>this.chart.series.getIndex(0).dataItems.getIndex(this.chart.series.getIndex(0).dataItems.length - 1);
      this.chart.addData(
        { date: new Date(lastdataItem.dateX.getTime() + 1000), value: x + 60 },
        1
      );
    })
  };

  ngOnDestroy() {
    super.ngOnDestroy();
    if (this.liveDataSubscription) {
      this.liveDataSubscription.unsubscribe();
    }
  }
}
