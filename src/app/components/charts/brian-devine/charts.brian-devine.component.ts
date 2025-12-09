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

import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import { AxisRendererCircular, CategoryAxis, DateAxis, RadarColumn } from '@amcharts/amcharts4/charts';
import { DashboardChartAbstractDirective } from '../dashboard-chart-abstract-component.directive';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { isNumber } from '@sports-alliance/sports-lib/lib/events/utilities/helpers';
import { ChartDataCategoryTypes } from '@sports-alliance/sports-lib/lib/tiles/tile.settings.interface';

@Component({
  selector: 'app-brian-devine-chart',
  templateUrl: './charts.brian-devine.component.html',
  styleUrls: ['./charts.brian-devine.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsBrianDevineComponent extends DashboardChartAbstractDirective implements OnChanges, OnDestroy, AfterViewInit {

  chartDataCategoryType = ChartDataCategoryTypes.DateType;

  declare data: {
    weekly: any[], daily: any[],
    activityTypes: ActivityTypes[]
  };

  useAnimations = true;

  protected declare chart: am4charts.RadarChart;


  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  ngAfterViewInit(): void {
    am4core.options.queue = true;
    am4core.options.onlyShowOnViewport = false;
    this.chart = this.createChart(am4charts.RadarChart, this.data);
    if (!this.data || !this.data.daily || !this.data.daily.length || !this.data.weekly || !this.data.weekly.length) {
      return
    }
    this.createSeriesForChart(this.chart, <CategoryAxis<am4charts.AxisRendererRadial>>this.chart.yAxes.getIndex(1), this.data)
    this.createDateAxisRanges(<DateAxis<AxisRendererCircular>>this.chart.xAxes.getIndex(0), this.data)
  }


  ngOnChanges(simpleChanges) {
    this.isLoading ? this.loading() : this.loaded();
    // If there is a new theme we need to destroy the chart and readd the data;
    // If theme changes destroy the chart
    if (simpleChanges.chartTheme && this.chart) {
      this.destroyChart();
      this.chart = this.createChart(am4charts.RadarChart, this.data);
    }

    if (!this.data || !this.data.daily || !this.data.daily.length || !this.data.weekly || !this.data.weekly.length) {
      if (this.chart) {
        this.clearSeriesForChart(this.chart);
        this.clearDateAxisRanges(<DateAxis<AxisRendererCircular>>this.chart.xAxes.getIndex(0));
      }
      return
    }

    if (simpleChanges.data) {
      this.data.daily = this.data.daily
        .map((data) => {
          return { ...data, ...{ day: new Date(data.time).toLocaleString('en-us', { weekday: 'short' }) } }
        });
      if (this.chart) {
        this.clearSeriesForChart(this.chart);
        this.clearDateAxisRanges(<DateAxis<AxisRendererCircular>>this.chart.xAxes.getIndex(0));
        this.createSeriesForChart(this.chart, <CategoryAxis<am4charts.AxisRendererRadial>>this.chart.yAxes.getIndex(1), this.data)
        this.createDateAxisRanges(<DateAxis<AxisRendererCircular>>this.chart.xAxes.getIndex(0), this.data)
        this.chart.invalidateLabels()
      }
    }
  }

  protected createChart(chartType?: typeof am4charts.Chart, data?: {
    weekly: any[], daily: any[], activityTypes: ActivityTypes[]
  }): am4charts.RadarChart {

    return this.zone.runOutsideAngular(() => {

      const chart = <am4charts.RadarChart>super.createChart(am4charts.RadarChart);
      chart.innerRadius = am4core.percent(20);
      chart.radius = am4core.percent(95);
      chart.fontSize = '1em';
      chart.startAngle = 100;
      chart.endAngle = chart.startAngle + 340;

      chart.zoomOutButton.align = 'left';
      chart.zoomOutButton.valign = 'top';

      // Create axes
      const dateAxis = chart.xAxes.push(<am4charts.DateAxis<am4charts.AxisRendererCircular>>this.getCategoryAxis(this.chartDataCategoryType, this.chartDataTimeInterval));
      // dateAxis.baseInterval = {timeUnit: 'week', count: 1};
      dateAxis.renderer.innerRadius = am4core.percent(40);
      dateAxis.renderer.minGridDistance = 5;
      dateAxis.renderer.labels.template.relativeRotation = 0;
      dateAxis.renderer.labels.template.location = 0.5;
      dateAxis.renderer.labels.template.radius = am4core.percent(-58);
      dateAxis.renderer.labels.template.fontSize = '1em';

      // dateAxis.dateFormats.setKey('week', 'w');
      // dateAxis.periodChangeDateFormats.setKey('week', 'w');
      // dateAxis.dateFormatter.dateFormat = this.getChartDateFormat(this.chartDataTimeInterval);
      // dateAxis.dateFormats.setKey('week', this.getAxisDateFormat(this.chartDataTimeInterval));
      // dateAxis.periodChangeDateFormats.setKey('week', this.getAxisDateFormat(this.chartDataTimeInterval));
      dateAxis.cursorTooltipEnabled = false;

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
      // @todo should base to user start of the week day and be dynamycally generated by locale.
      // So better store it as number there
      dayAxis.data = [{ day: 'Mon' }, { day: 'Tue' }, { day: 'Wed' }, { day: 'Thu' }, { day: 'Fri' }, { day: 'Sat' }, { day: 'Sun' }]
      dayAxis.renderer.innerRadius = am4core.percent(50);
      dayAxis.renderer.minGridDistance = 10;
      dayAxis.renderer.grid.template.location = 0;
      dayAxis.renderer.line.disabled = true;
      dayAxis.renderer.axisAngle = 90;
      dayAxis.cursorTooltipEnabled = false;

      const label = chart.radarContainer.createChild(am4core.Label);
      label.horizontalCenter = 'middle';
      label.verticalCenter = 'middle';
      // label.fill = am4core.color('#ffffff');
      // label.fontWeight = 'bold';
      // label.text =
      label.adapter.add('text', (value, target, key) => {
        const aggrValue = this.getAggregateData(data.daily, this.chartDataValueType);
        return `[font-size: 1.3em]${aggrValue.getDisplayType()}[/]\n[bold font-size: 1.2em]${aggrValue.getDisplayValue()}${aggrValue.getDisplayUnit()}[/]\n(${this.chartDataValueType})`
      })

      return chart;
    })

  }

  private createDateAxisRanges(axis: am4charts.DateAxis<am4charts.AxisRendererCircular>, data: { weekly: any[], daily: any[] }) {
    // add month ranges
    // debugger
    const firstDay = new Date(data.weekly[0].time);
    const lastDay = new Date(data.weekly[data.weekly.length - 1].time + (7 * 24 * 60 * 60 * 1000));
    const firstMonth = firstDay.getMonth();

    // console.log(firstDay, lastDay)

    const totalNumberOfMonths = lastDay.getMonth() - firstDay.getMonth() +
      (12 * (lastDay.getFullYear() - firstDay.getFullYear())) + 1 // Note the +1 here

    for (let i = 0; i < totalNumberOfMonths; i++) {
      const range = axis.axisRanges.create();
      range.date = i === 0 ? firstDay : new Date(firstDay.getFullYear(), i + firstMonth, 0, 24, 0, 0);
      range.endDate = i === totalNumberOfMonths - 1 ? lastDay : new Date(firstDay.getFullYear(), i + firstMonth + 1, 0, 23, 59, 59, 999)
      console.log(`StartDate: ${range.date} end date: ${range.endDate}`)

      range.axisFill.fillOpacity = 1;
      (<am4charts.AxisFillCircular>range.axisFill).radius = -28;
      (<am4charts.AxisFillCircular>range.axisFill).adapter.add('innerRadius', function (innerRadius, target) {
        return axis.renderer.pixelRadius + 7;
      })
      range.axisFill.fill = this.getColorForMonth(range.date.getMonth())
      // range.axisFill.stroke = am4core.color('#b9ce37');
      range.grid.disabled = true;
      range.label.text = totalNumberOfMonths > 12
        ? `${range.endDate.toLocaleString('default', { month: 'long' })} ${range.endDate.getFullYear()}`
        : `${range.endDate.toLocaleString('default', { month: 'long' })}`;
      // range.label.text = chart.dateFormatter.language.translate(chart.dateFormatter.months[range.date.getMonth()]);
      (<am4charts.AxisLabelCircular>range.label).bent = true;
      (<am4charts.AxisLabelCircular>range.label).radius = 12;
      range.label.fontSize = '1.1em';
      range.label.paddingBottom = 0;
      range.label.interactionsEnabled = false;
      range.axisFill.interactionsEnabled = true;
      range.axisFill.cursorOverStyle = am4core.MouseCursorStyle.pointer;
      range.axisFill.events.on('hit', function (event) {
        if (axis.start === 0 && axis.end === 1) {
          axis.zoomToDates((<any>event.target.dataItem).date, (<any>event.target.dataItem).endDate);
        } else {
          axis.zoom({ start: 0, end: 1 });
        }
      })
    }
  }

  private clearDateAxisRanges(axis: am4charts.DateAxis<am4charts.AxisRendererCircular>) {
    axis.axisRanges.clear();
  }

  private createSeriesForChart(chart: am4charts.RadarChart, axis: am4charts.CategoryAxis<am4charts.AxisRendererRadial>, data: {
    weekly: any[], daily: any[],
    activityTypes: ActivityTypes[]
  }) {
    // Create series
    data.activityTypes.forEach((activityType, index) => {
      this.createSerieForChart(activityType, chart, axis, data);
    })
  }

  private createSerieForChart(activityType: ActivityTypes, chart: am4charts.RadarChart, axis: am4charts.CategoryAxis<am4charts.AxisRendererRadial>, data: {
    weekly: any[], daily: any[],
    activityTypes: ActivityTypes[]
  }) {
    const columnSeries = chart.series.push(new am4charts.RadarColumnSeries());
    columnSeries.stacked = true;
    columnSeries.data = data.weekly;
    columnSeries.dataFields.dateX = 'time';
    columnSeries.dataFields.valueY = activityType;
    columnSeries.columns.template.strokeOpacity = 0;
    columnSeries.columns.template.width = am4core.percent(95);
    columnSeries.fill = am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType));
    // columnSeries.fillOpacity = 0.6;
    columnSeries.tooltip.fontSize = '1em';
    columnSeries.tooltip.pointerOrientation = 'down';
    columnSeries.tooltip.background.fillOpacity = 1;
    columnSeries.columns.template.tooltipText = '{valueY}';
    // @ts-ignore
    columnSeries.columns.template.adapter.add('tooltipText', (text: string, target: RadarColumn, key: 'tooltipText') => {
      if (!target.dataItem || !target.dataItem.dataContext || !target.dataItem.dataContext[activityType]) {
        return '';
      }
      const dataItem = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[activityType]);
      return `${activityType}\n{dateX.formatDate("${this.getChartDateFormat(this.chartDataTimeInterval)}")}\n[bold]${this.chartDataValueType}: ${dataItem.getDisplayValue()}${dataItem.getDisplayUnit()}[/b]\n${target.dataItem.dataContext[`${activityType}-Count`] ? `[bold]${target.dataItem.dataContext[`${activityType}-Count`]}[/b] Activities` : ``}`
    });
    columnSeries.cursorTooltipEnabled = false;

    // bubble series
    const bubbleSeries = chart.series.push(new am4charts.RadarSeries())
    bubbleSeries.simplifiedProcessing = true
    bubbleSeries.name = activityType;
    bubbleSeries.dataFields.dateX = 'time';
    bubbleSeries.dataFields.categoryY = 'day';
    bubbleSeries.dataFields.value = activityType;
    bubbleSeries.yAxis = axis;
    bubbleSeries.data = data.daily.filter((dataItem) => (dataItem[activityType]));
    bubbleSeries.strokeOpacity = 0;

    // bubbleSeries.fillOpacity = 0;

    bubbleSeries.maskBullets = false;
    bubbleSeries.cursorTooltipEnabled = false;
    bubbleSeries.tooltip.fontSize = '1em';
    bubbleSeries.tooltip.pointerOrientation = 'down';
    // bubbleSeries.tooltip.background.fillOpacity = 0.8;


    bubbleSeries.bulletsContainer = chart.bulletsContainer;

    const bubbleBullet = bubbleSeries.bullets.push(new am4charts.CircleBullet())
    bubbleBullet.locationX = 0.5;
    bubbleBullet.stroke = am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType));
    bubbleBullet.fill = am4core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(activityType));
    // bubbleBullet.fillOpacity = 0;
    bubbleBullet.tooltipText = '{value}';
    bubbleBullet.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext || !target.dataItem.dataContext[activityType]) {
        return '';
      }
      const dataItem = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[activityType]);
      return `${activityType}\n{dateX}\n[bold]${this.chartDataValueType}: ${dataItem.getDisplayValue()}${dataItem.getDisplayUnit()}[/b]\n${target.dataItem.dataContext[`${activityType}-Count`] ? `[bold]${target.dataItem.dataContext[`${activityType}-Count`]}[/b] Activities` : ``}`
    });
    bubbleBullet.adapter.add('tooltipY', function (tooltipY, target) {
      return -target.circle.radius;
    })
    bubbleBullet.circle.adapter.add('radius', (value, target, key) => {
      const activityDataFromDataItem = this.data.activityTypes.reduce((obj, dataActivityType) => {
        if (!isNumber(target.dataItem.dataContext[dataActivityType])) {
          return obj
        }
        obj[dataActivityType] = target.dataItem.dataContext[dataActivityType]
        return obj
      }, {})
      const index = Object.keys(activityDataFromDataItem).sort(function (a, b) {
        return activityDataFromDataItem[a] - activityDataFromDataItem[b]
      }).indexOf(activityType);
      const percentage = ((1 / Object.keys(activityDataFromDataItem).length) * 100) * (index + 1);
      return 8 * (percentage / 100)
    })
    bubbleSeries.dataItems.template.locations.categoryY = 0.5;
    bubbleSeries.events.on('ready', () => {
      this.sortAllBullets(chart, bubbleSeries)
    });
  }

  private clearSeriesForChart(chart: am4charts.RadarChart) {
    chart.series.clear()
  }

  private sortAllBullets(chart: am4charts.RadarChart, series?) {
    series.bullets.each((bullet) => {
      bullet.clones.each((item) => {
        if (!item.dataItem || !item.dataItem.dataContext) {
          return;
        }

        // Find the activities from the dataItem
        const activityDataFromDataItem = this.data.activityTypes.reduce((obj, dataActivityType) => {
          if (!isNumber(item.dataItem.dataContext[dataActivityType])) {
            return obj
          }
          obj[dataActivityType] = item.dataItem.dataContext[dataActivityType]
          return obj
        }, {})
        item.zIndex = Object.keys(activityDataFromDataItem).sort(function (a, b) {
          return activityDataFromDataItem[b] - activityDataFromDataItem[a]
        }).indexOf(series.name) + 1
        // debugger;
        chart.invalidateLayout();
      })
    })
  }

  private getColorForMonth(month: number) {
    switch (month) {
      default:
      case 0:
        return am4core.color('#0b85ce');
      case 1:
        return am4core.color('#1893bc');
      case 2:
        return am4core.color('#0da157');
      case 3:
        return am4core.color('#88bc4e');
      case 4:
        return am4core.color('#ced629');
      case 5:
        return am4core.color('#f3bf1e');
      case 6:
        return am4core.color('#f39b1f');
      case 7:
        return am4core.color('#f13f19');
      case 8:
        return am4core.color('#f15c74');
      case 9:
        return am4core.color('#c9428e');
      case 10:
        return am4core.color('#8752ba');
      case 11:
        return am4core.color('#5f58c0');
    }
  }
}
