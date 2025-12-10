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
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { ChartAbstractDirective } from '../../charts/chart-abstract.directive';
import type * as am4core from '@amcharts/amcharts4/core';
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

  private _am4core: typeof am4core;
  private _am4charts: typeof am4charts;

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  async ngAfterViewInit() {
    this.chart = await this.createChart();
    this.subscribeToLiveData();
  }

  protected async createChart(): Promise<am4charts.XYChart> {
    const { am4core, am4charts } = await this.loadAmCharts();
    this._am4core = am4core;
    this._am4charts = am4charts;
    const chart = <am4charts.XYChart>(await super.createChart(am4charts.XYChart));

    // chart.exporting.menu = this.getExportingMenu();
    chart.hiddenState.properties.opacity = 0;
    chart.padding(10, 0, 0, 1);
    chart.fontSize = '0.8em';


    chart.zoomOutButton.disabled = true;

    chart.data = this.getInitialData();

    const dateAxis = chart.xAxes.push(new this._am4charts.DateAxis());
    dateAxis.renderer.grid.template.location = 0;
    dateAxis.renderer.minGridDistance = 30;
    dateAxis.dateFormats.setKey('second', 'ss');
    dateAxis.periodChangeDateFormats.setKey('second', '[bold]h:mm a');
    dateAxis.periodChangeDateFormats.setKey('minute', '[bold]h:mm a');
    dateAxis.periodChangeDateFormats.setKey('hour', '[bold]h:mm a');
    dateAxis.renderer.inside = true;
    dateAxis.renderer.axisFills.template.disabled = true;
    dateAxis.renderer.ticks.template.disabled = true;

    const valueAxis = chart.yAxes.push(new this._am4charts.ValueAxis());
    valueAxis.tooltip.disabled = true;
    valueAxis.interpolationDuration = 500;
    valueAxis.rangeChangeDuration = 500;
    valueAxis.renderer.inside = true;
    valueAxis.renderer.minLabelPosition = 0.05;
    valueAxis.renderer.maxLabelPosition = 0.95;
    valueAxis.renderer.axisFills.template.disabled = true;
    valueAxis.renderer.ticks.template.disabled = true;

    const series = chart.series.push(new this._am4charts.LineSeries());
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
    const gradient = new this._am4core.LinearGradient();
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
      // Need to cast to handle dynamic typing if needed, but if this.chart is typed correctly it's fine.
      // However, we need to be careful with access if chart is not yet created?
      // ngAfterViewInit awaits creation so this should be safe.
      if (!this.chart) return;

      // Accessing series by index. The type system might complain about getIndex returning generic Sprite.
      const series = <am4charts.LineSeries>this.chart.series.getIndex(0);
      if (series && series.dataItems) {
        const lastdataItem = <LineSeriesDataItem>series.dataItems.getIndex(series.dataItems.length - 1);
        if (lastdataItem) {
          this.chart.addData(
            { date: new Date(lastdataItem.dateX.getTime() + 1000), value: x + 60 },
            1
          );
        }
      }
    })
  }

  ngOnDestroy() {
    super.ngOnDestroy();
    if (this.liveDataSubscription) {
      this.liveDataSubscription.unsubscribe();
    }
  }
}
