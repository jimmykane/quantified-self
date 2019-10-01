import {ChartAbstract} from './chart.abstract';
import {Input, OnChanges} from '@angular/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import {string} from '@amcharts/amcharts4/core';


export abstract class DashboardChartAbstract extends ChartAbstract implements OnChanges  {
  @Input() data: any;

  ngOnChanges(simpleChanges) {
    // If theme changes destroy the chart
    if (simpleChanges.chartTheme) {
      this.destroyChart();
    }

    if (!this.data){
      this.loading();
      return;
    }

    this.loaded();
    if (!this.data.length){
      return ;
    }

    // 1. If there is no chart create
    if (!this.chart) {
      this.chart = <am4charts.XYChart|am4charts.XYChart>this.createChart();
      this.chart.data = [];
    }


    if (!simpleChanges.data && !simpleChanges.chartTheme) {
      return;
    }


    // To create an animation here it has to update the values of the data items
    this.chart.data = this.generateChartData(this.data);
  }

  protected abstract generateChartData(data): {type: string, value: number, id: number}[];
}
