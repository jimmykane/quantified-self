import {
  AfterViewInit,
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';

import { AmChartsService } from '../../../services/am-charts.service';

// Type-only imports
import type * as am4core from '@amcharts/amcharts4/core';
import type * as am4charts from '@amcharts/amcharts4/charts';
import type * as am4plugins_timeline from '@amcharts/amcharts4/plugins/timeline';


import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { DashboardChartAbstractDirective } from '../dashboard-chart-abstract-component.directive';
import { SummariesChartDataInterface } from '../../summaries/summaries.component';
import { ChartHelper } from '../../event/chart/chart-helper';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-timeline-chart',
  templateUrl: './charts.timeline.component.html',
  styleUrls: ['./charts.timeline.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsTimelineComponent extends DashboardChartAbstractDirective implements OnChanges, OnDestroy {



  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private eventColorService: AppEventColorService, protected amChartsService: AmChartsService) {
    super(zone, changeDetector, amChartsService);
  }

  protected async createChart(): Promise<am4charts.XYChart> {
    const { core, charts } = await this.amChartsService.load();
    const timeline = await import('@amcharts/amcharts4/plugins/timeline');

    const chart = await super.createChart(timeline.SpiralChart) as am4plugins_timeline.SpiralChart;
    chart.levelCount = 2;
    chart.inversed = true;
    chart.endAngle = -90;
    chart.yAxisInnerRadius = core.percent(15);
    chart.yAxisRadius = core.percent(120);
    chart.innerRadius = core.percent(60);

    chart.paddingTop = 0;
    chart.paddingBottom = 0;
    chart.fontSize = '0.8em';

    const categoryAxis = chart.yAxes.push(<am4charts.Axis<am4plugins_timeline.AxisRendererCurveY>>this.getCategoryAxis(this.chartDataCategoryType, this.chartDataTimeInterval, charts));
    // categoryAxis.dataFields.category = 'time';
    if (categoryAxis instanceof charts.CategoryAxis) {
      categoryAxis.dataFields.category = 'type';
    } else if (categoryAxis instanceof charts.DateAxis) {
      categoryAxis.dataFields.date = 'time';
      chart.dateFormatter.dateFormat = categoryAxis.dateFormatter.dateFormat;
    }
    categoryAxis.renderer.grid.template.disabled = true;
    categoryAxis.renderer.minGridDistance = 4;
    categoryAxis.cursorTooltipEnabled = false;


    categoryAxis.renderer.labels.template.disabled = false;
    const categoryAxisLabelTemplate = categoryAxis.renderer.labels.template;
    categoryAxisLabelTemplate.paddingLeft = 20;
    categoryAxisLabelTemplate.horizontalCenter = 'left';
    categoryAxisLabelTemplate.adapter.add('rotation', (rotation, target) => {
      const position = valueAxis.valueToPosition(valueAxis.min);
      return valueAxis.renderer.positionToAngle(position) + 80;
    });
    categoryAxisLabelTemplate.adapter.add('text', (text, target, key) => {
      let chartDataItem;
      if (target.dataItem instanceof charts.DateAxisDataItem && target.axis) {
        chartDataItem = target.axis.chart.data.find((chartData: SummariesChartDataInterface) => chartData.time === (<am4charts.DateAxisDataItem>target.dataItem).value);
      } else if (target.dataItem instanceof charts.CategoryAxisDataItem) {
        chartDataItem = <SummariesChartDataInterface>target.dataItem.dataContext;
      }
      if (!chartDataItem) {
        return `[bold font-size: 0.8em]${text}[/]`;
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, chartDataItem[this.chartDataValueType]);
      return `[bold font-size: 0.8em]${text} ${data.getDisplayValue()} ${data.getDisplayUnit()}[/]`;
    });

    const valueAxis = chart.xAxes.push(<am4charts.ValueAxis<am4plugins_timeline.AxisRendererCurveX>>new charts.ValueAxis());
    valueAxis.renderer.minGridDistance = 100;

    // valueAxis.renderer.line.strokeDasharray = '1,0';
    // valueAxis.renderer.line.strokeOpacity = this.getStrokeOpacity();
    valueAxis.hidden = true;
    // valueAxis.renderer.line.strokeWidth = 0;
    // valueAxis.renderer.grid.template.disabled = true;
    valueAxis.zIndex = 100;
    valueAxis.cursorTooltipEnabled = false;
    valueAxis.min = 0;


    valueAxis.numberFormatter = new core.NumberFormatter();
    valueAxis.numberFormatter.numberFormat = `#`;
    // valueAxis.renderer.labels.template.adapter.add('text', (text, target) => {
    //   const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
    //   return `[bold font-size: 1.2em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
    // });

    const labelTemplate = valueAxis.renderer.labels.template;
    labelTemplate.verticalCenter = 'middle';
    labelTemplate.fillOpacity = this.getFillOpacity();

    const series = chart.series.push(new timeline.CurveColumnSeries());
    if (categoryAxis instanceof charts.CategoryAxis) {
      series.dataFields.categoryY = 'type';
    } else if (categoryAxis instanceof charts.DateAxis) {
      series.dataFields.dateY = 'time';
    }
    series.dataFields.valueX = this.chartDataValueType;


    series.columns.template.adapter.add('fill', (fill, target) => {
      if (categoryAxis instanceof charts.CategoryAxis) {
        return core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext['type']]));
      }
      return this.getFillColor(chart, target.dataItem.index);
    });

    series.strokeWidth = 0;
    series.columns.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[this.chartDataValueType]);
      return `${'{dateY}{categoryY}'} ${target.dataItem.dataContext['count'] ? `(x${target.dataItem.dataContext['count']})` : ``} [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b] (${this.chartDataValueType})`
    });

    // series.columns.template.filters.push(ChartHelper.getShadowFilter());

    const label = series.createChild(core.Label);
    label.horizontalCenter = 'middle';
    label.paddingLeft = 20;
    label.verticalCenter = 'middle';
    label.adapter.add('text', (text, target, key) => {
      const data = this.getAggregateData((<am4charts.Series>target.parent).chart.data, this.chartDataValueType);
      // return `[font-size: 1.3em]${value.getDisplayType()}[/] [bold font-size: 1.4em]${value.getDisplayValue()}${value.getDisplayUnit()}[/] (${this.chartDataValueType} )`;
      return `[font-size: 1.3em]${data.getDisplayType()}[/]
              [font-size: 1.4em]${data.getDisplayValue()}${data.getDisplayUnit()}[/]
              [font-size: 1.0em]${this.chartDataValueType}[/]`
    });

    const hoverState = series.columns.template.states.create('hover');
    hoverState.properties.fillOpacity = 1;


    // chart.scrollbarX = new am4core.Scrollbar();
    // chart.scrollbarX.align = 'center'
    // chart.scrollbarX.width = am4core.percent(70);


    // const cursor = new am4plugins_timeline.CurveCursor();
    // chart.cursor = cursor;
    // cursor.xAxis = valueAxis;
    // cursor.yAxis = categoryAxis;
    // cursor.lineY.disabled = true;
    // cursor.lineX.strokeDasharray = '1,4';
    // cursor.lineX.strokeOpacity = 1;


    return chart;
  }
}
