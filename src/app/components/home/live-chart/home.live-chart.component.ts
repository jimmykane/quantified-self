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

import type * as am4charts from '@amcharts/amcharts4/charts';
import type * as am4core from '@amcharts/amcharts4/core';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { ChartAbstractDirective } from '../../charts/chart-abstract.directive';
import { AmChartsService } from '../../../services/am-charts.service';
import { LoggerService } from '../../../services/logger.service';

import { range, Subscription, timer } from 'rxjs';
import { take } from 'rxjs/operators';
import type { LineSeriesDataItem } from '@amcharts/amcharts4/charts';


@Component({
  selector: 'app-home-live-chart',
  templateUrl: './home.live-chart.component.html',
  styleUrls: ['./home.live-chart.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class HomeLiveChartComponent extends ChartAbstractDirective implements OnDestroy, AfterViewInit {


  protected liveDataSubscription: Subscription;

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected eventColorService: AppEventColorService, protected amChartsService: AmChartsService, protected logger: LoggerService) {
    super(zone, changeDetector, amChartsService, logger);
  }

  async ngAfterViewInit(): Promise<void> {
    this.chart = await this.createChart();
    this.subscribeToLiveData();
  }

  protected async createChart(): Promise<am4charts.XYChart> {
    const { core, charts } = await this.amChartsService.load();
    const chart = await super.createChart(charts.XYChart) as am4charts.XYChart;

    // chart.exporting.menu = this.getExportingMenu();
    chart.hiddenState.properties.opacity = 0;
    chart.padding(10, 0, 0, 1);
    chart.fontSize = '0.8em';


    chart.zoomOutButton.disabled = true;

    chart.data = this.getInitialData();

    const dateAxis = chart.xAxes.push(new charts.DateAxis());
    dateAxis.renderer.grid.template.location = 0;
    dateAxis.renderer.minGridDistance = 30;
    dateAxis.dateFormats.setKey('second', 'ss');
    dateAxis.periodChangeDateFormats.setKey('second', '[bold]h:mm a');
    dateAxis.periodChangeDateFormats.setKey('minute', '[bold]h:mm a');
    dateAxis.periodChangeDateFormats.setKey('hour', '[bold]h:mm a');
    dateAxis.renderer.inside = true;
    dateAxis.renderer.axisFills.template.disabled = true;
    dateAxis.renderer.ticks.template.disabled = true;

    const valueAxis = chart.yAxes.push(new charts.ValueAxis());
    valueAxis.tooltip.disabled = true;
    valueAxis.interpolationDuration = 500;
    valueAxis.rangeChangeDuration = 500;
    valueAxis.renderer.inside = true;
    valueAxis.renderer.minLabelPosition = 0.05;
    valueAxis.renderer.maxLabelPosition = 0.95;
    valueAxis.renderer.axisFills.template.disabled = true;
    valueAxis.renderer.ticks.template.disabled = true;

    const series = chart.series.push(new charts.LineSeries());
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
    const gradient = new core.LinearGradient();
    gradient.addColor(chart.colors.getIndex(0), 0.2);
    gradient.addColor(chart.colors.getIndex(0), 0);
    series.fill = gradient;


    return chart;
  }

  private getInitialData(): { date: number, value: number }[] {
    const now = new Date();
    return [...Array(10).keys()].map(i => {
      return {
        date: new Date(now.getTime() + (i * 1000)).getTime(),
        value: 70
      }
    })
  }

  private subscribeToLiveData() {
    this.liveDataSubscription = timer(1000, 500).pipe().subscribe(x => {
      const lastdataItem = <LineSeriesDataItem>this.chart.series.getIndex(0).dataItems.getIndex(this.chart.series.getIndex(0).dataItems.length - 1);
      this.chart.addData(
        { date: new Date(lastdataItem.dateX.getTime() + 1000), value: x + 60 },
        1
      );
    })
  }

  ngOnDestroy() {
    super.ngOnDestroy();
    if (this.liveDataSubscription) {
      this.liveDataSubscription.unsubscribe();
    }
  }
}
