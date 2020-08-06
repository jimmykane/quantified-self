import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
} from '@angular/core';
import { Log } from 'ng2-logger/browser'
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import { DashboardChartAbstract } from '../dashboard-chart.abstract';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { Activity } from '@sports-alliance/sports-lib/lib/activities/activity';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';

@Component({
  selector: 'app-brian-devine-chart',
  templateUrl: './charts.brian-devine.component.html',
  styleUrls: ['./charts.brian-devine.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsBrianDevineComponent extends DashboardChartAbstract implements OnChanges, OnDestroy {

  @Input() data: {
    weekly: any[], daily: any[],
    activityTypes: ActivityTypes[]
  };

  protected chart: am4charts.RadarChart;
  protected logger = Log.create('ChartsBrianDevineComponent');

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  ngAfterViewInit(): void {
    am4core.options.queue = true;
    am4core.options.onlyShowOnViewport = false;
    if (!this.chart) {
      this.chart = this.createChart(am4charts.RadarChart, this.data);
    }
  }

  ngOnChanges(simpleChanges) {
    this.isLoading ? this.loading() : this.loaded();
    // If there is a new theme we need to destroy the chart and readd the data;
    // If theme changes destroy the chart
    if (simpleChanges.data || (simpleChanges.chartTheme && this.chart)) {
      this.data.weekly = [...this.data.weekly]
        .map((data) => {
          return {...data, ...{endTime: data.time + 7 * 24 * 60 * 60 * 1000}}
        });
      this.data.daily = [...this.data.daily]
        .map((data) => {
          return {...data, ...{day: new Date(data.time).toLocaleString('en-us', {weekday: 'short'})}}
        });
      this.chart = <am4charts.RadarChart>this.createChart(am4charts.RadarChart, this.data);
      debugger;
      // this.chart.data = this.data.daily;
      // this.chart.yAxes.each((axis) => axis.data = this.data.daily)
      // this.chart.series.each((series) => series.data = this.data.daily)
    }


  }

  protected createChart(chartType?: typeof am4charts.Chart, data?: {
    weekly: any[], daily: any[], activityTypes: ActivityTypes[]}): am4charts.RadarChart {

    // debugger
    const chart = <am4charts.RadarChart>super.createChart(am4charts.RadarChart);
    // chart.data = data.weekly; @todo is this needed

    chart.innerRadius = am4core.percent(15);
    chart.radius = am4core.percent(90);
    chart.fontSize = '11px';
    chart.startAngle = 100;
    chart.endAngle = chart.startAngle + 340;
    // Create axes
    // debugger;
    const dateAxis = chart.xAxes.push(<am4charts.DateAxis<am4charts.AxisRendererCircular>>this.getCategoryAxis(this.chartDataCategoryType, this.chartDataTimeInterval));
    // dateAxis.baseInterval = {timeUnit: 'week', count: 1};
    dateAxis.renderer.innerRadius = am4core.percent(40);
    dateAxis.renderer.minGridDistance = 5;
    dateAxis.renderer.labels.template.relativeRotation = 0;
    dateAxis.renderer.labels.template.location = 0.5;
    dateAxis.renderer.labels.template.radius = am4core.percent(-57);
    dateAxis.renderer.labels.template.fontSize = '8px';
    // dateAxis.dateFormats.setKey('week', 'w');
    // dateAxis.periodChangeDateFormats.setKey('week', 'w');
    // dateAxis.dateFormatter.dateFormat = this.getChartDateFormat(this.chartDataTimeInterval);
    // dateAxis.dateFormats.setKey(key, this.getAxisDateFormat(this.chartDataTimeInterval));
    // dateAxis.periodChangeDateFormats.setKey(key, this.getAxisDateFormat(this.chartDataTimeInterval));

    dateAxis.cursorTooltipEnabled = false;

    // Add ranges
    this.createDateAxisRanges(dateAxis, this.data);

    const valueAxis = chart.yAxes.push(<am4charts.ValueAxis<am4charts.AxisRendererRadial>>new am4charts.ValueAxis());
    valueAxis.renderer.inversed = true;
    valueAxis.renderer.radius = am4core.percent(40);
    valueAxis.renderer.minGridDistance = 15;
    valueAxis.renderer.minLabelPosition = 0.05;
    valueAxis.renderer.grid.template.disabled = true;
    valueAxis.renderer.axisAngle = 90;
    valueAxis.cursorTooltipEnabled = false;
    valueAxis.renderer.labels.template.fill = am4core.color('#ffffff');
    valueAxis.renderer.labels.template.disabled = true;

    // day axis
    const dayAxis = chart.yAxes.push(<am4charts.CategoryAxis<am4charts.AxisRendererRadial>>new am4charts.CategoryAxis());
    dayAxis.dataFields.category = 'day';
    dayAxis.data = this.data.daily;
    dayAxis.renderer.innerRadius = am4core.percent(50);
    dayAxis.renderer.minGridDistance = 10;
    dayAxis.renderer.grid.template.location = 0;
    dayAxis.renderer.line.disabled = true;
    dayAxis.renderer.axisAngle = 90;
    dayAxis.cursorTooltipEnabled = false;
    // dayAxis.renderer.labels.template.fill = am4core.color('#ffffff');


debugger

    // Create series
    const columnSeries = chart.series.push(new am4charts.RadarColumnSeries());
    columnSeries.data = data.weekly;
    columnSeries.dataFields.dateX = 'time';
    columnSeries.dataFields.valueY = 'value';
    columnSeries.columns.template.strokeOpacity = 0;
    columnSeries.columns.template.width = am4core.percent(95);
    columnSeries.fill = am4core.color('#ffffff');
    columnSeries.fillOpacity = 0.6;
    columnSeries.tooltip.fontSize = 10;
    columnSeries.tooltip.pointerOrientation = 'down';
    columnSeries.tooltip.background.fillOpacity = 0.5;
    columnSeries.columns.template.tooltipText = '{valueY}';
    columnSeries.columns.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      const dataItem = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
      return `{dateX}\n[bold]${this.chartDataValueType}: ${dataItem.getDisplayValue()}${dataItem.getDisplayUnit()}[/b]\n${target.dataItem.dataContext['count'] ? `[bold]${target.dataItem.dataContext['count']}[/b] Activities` : ``}`
    });
    columnSeries.cursorTooltipEnabled = false;


    this.data.activityTypes.forEach((activityType, index) => {
      // if (index > 0){
      //   return
      // }
      this.createSeriesForChart(activityType, chart, dayAxis, data);
    })


    chart.cursor = new am4charts.RadarCursor();
    chart.cursor.innerRadius = am4core.percent(40);
    chart.cursor.lineY.disabled = true;


    const label = chart.radarContainer.createChild(am4core.Label);
    label.horizontalCenter = 'middle';
    label.verticalCenter = 'middle';
    // label.fill = am4core.color('#ffffff');
    label.fontSize = 12;
    label.fontWeight = 'bold';
    label.adapter.add('text', (text, target, key) => {
      const dataItem = target.parent.parent.parent.parent.parent.parent['data'];
      const value = this.getAggregateData(dataItem, this.chartDataValueType);
      return `[font-size: 1.4em]${value.getDisplayType()}[/]\n[bold font-size: 1.3em]${value.getDisplayValue()}${value.getDisplayUnit()}[/]\n(${this.chartDataValueType})`;
    });

    const title = chart.createChild(am4core.Label);
    title.fill = am4core.color('#b9ce37');
    title.fontSize = 20;
    title.isMeasured = false;
    title.valign = 'top';
    title.align = 'left';
    title.wrap = true;
    title.width = 200;
    // @todo
    // title.text = '[bold]IN ' + firstDay.getFullYear() + '\nI CYCLED ' + Math.round(total) + ' km.\n[font-size:11; #ffffff]Each circle represents a bike ride. Size represents distance.';

    // const link = chart.createChild(am4core.TextLink);
    // link.fill = am4core.color('#ffffff');
    // link.fontSize = 13;
    // link.url = 'https://www.instagram.com/brian_devine/';
    // link.valign = 'bottom';
    // link.align = 'right';
    // link.marginRight = 10;
    // link.text = 'Chart design inspired by Brian Devine';

    return chart;
  }

  // ngOnChanges(changes: SimpleChanges) {
  // }
  private processChartChanges() {

  }

  private createDateAxisRanges(axis: am4charts.DateAxis<am4charts.AxisRendererCircular>, data: { weekly: any[], daily: any[] }) {
    // add month ranges
    const firstDay = new Date(this.data.daily[0].time);
    const lastDay = new Date(this.data.daily[this.data.daily.length - 1].time);

    const totalNumberOfMonths = lastDay.getMonth() - firstDay.getMonth() +
      (12 * (lastDay.getFullYear() - firstDay.getFullYear())) + 1 // Note the +1 here

    // debugger
    for (let i = 0; i < totalNumberOfMonths; i++) {
      const range = axis.axisRanges.create();
      range.date = new Date(firstDay.getFullYear(), i, 0, 0, 0, 0);
      range.endDate = new Date(firstDay.getFullYear(), i + 1, 0, 0, 0, 0)
      if (i % 2) {
        range.axisFill.fillOpacity = 0.4;
      } else {
        range.axisFill.fillOpacity = 0.8;
      }
      (<am4charts.AxisFillCircular>range.axisFill).radius = -28;
      (<am4charts.AxisFillCircular>range.axisFill).adapter.add('innerRadius', function (innerRadius, target) {
        return axis.renderer.pixelRadius + 7;
      })
      range.axisFill.fill = am4core.color('#b9ce37');
      range.axisFill.stroke = am4core.color('#5f6062');
      range.grid.disabled = true;
      range.label.text = totalNumberOfMonths > 12
        ? `${range.endDate.toLocaleString('default', {month: 'long'})} ${range.endDate.getFullYear()}`
        : `${range.endDate.toLocaleString('default', {month: 'long'})}`;
      // range.label.text = chart.dateFormatter.language.translate(chart.dateFormatter.months[range.date.getMonth()]);
      (<am4charts.AxisLabelCircular>range.label).bent = true;
      (<am4charts.AxisLabelCircular>range.label).radius = 10;
      range.label.fontSize = 10;
      range.label.paddingBottom = 5;
      range.label.interactionsEnabled = false;
      range.axisFill.interactionsEnabled = true;
      range.axisFill.cursorOverStyle = am4core.MouseCursorStyle.pointer;
      range.axisFill.events.on('hit', function (event) {
        if (axis.start === 0 && axis.end === 1) {
          axis.zoomToDates((<any>event.target.dataItem).date, (<any>event.target.dataItem).endDate);
        } else {
          axis.zoom({start: 0, end: 1});
        }
      })
    }
  }

  private createSeriesForChart(activityType: ActivityTypes, chart: am4charts.RadarChart, axis: am4charts.CategoryAxis<am4charts.AxisRendererRadial>, data: { weekly: any[], daily: any[], }) {
    // debugger
    // debugger



    // bubble series
    const bubbleSeries = chart.series.push(new am4charts.RadarSeries())
    bubbleSeries.dataFields.dateX = 'time';
    bubbleSeries.dataFields.categoryY = 'day';
    bubbleSeries.dataFields.value = activityType;
    bubbleSeries.yAxis = axis;
    bubbleSeries.data = data.daily;
    bubbleSeries.strokeOpacity = 0;
    bubbleSeries.maskBullets = false;
    bubbleSeries.cursorTooltipEnabled = false;
    bubbleSeries.tooltip.fontSize = 10;
    bubbleSeries.tooltip.pointerOrientation = 'down';
    bubbleSeries.tooltip.background.fillOpacity = 0.8;

    const bubbleBullet = bubbleSeries.bullets.push(new am4charts.CircleBullet())
    bubbleBullet.locationX = 0.5;
    bubbleBullet.stroke = am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType));
    bubbleBullet.fill = am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType));
    bubbleBullet.tooltipText = '{value}';
    bubbleBullet.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      debugger
      const dataItem = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[activityType]);
      return `{dateX}\n[bold]${this.chartDataValueType}: ${dataItem.getDisplayValue()}${dataItem.getDisplayUnit()}[/b]\n${target.dataItem.dataContext['count'] ? `[bold]${target.dataItem.dataContext['count']}[/b] Activities` : ``}`
    });
    bubbleBullet.adapter.add('tooltipY', function (tooltipY, target) {
      return -target.circle.radius;
    })
    // //
    bubbleSeries.heatRules.push({target: bubbleBullet.circle, min: 2, max: 12, dataField: 'value', property: 'radius'});
    bubbleSeries.dataItems.template.locations.categoryY = 0.5;
  }
}
