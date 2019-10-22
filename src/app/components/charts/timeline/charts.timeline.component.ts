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
import {Log} from 'ng2-logger/browser'
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import * as am4plugins_timeline from '@amcharts/amcharts4/plugins/timeline';

import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DashboardChartAbstract} from '../dashboard-chart.abstract';

@Component({
  selector: 'app-timeline-chart',
  templateUrl: './charts.timeline.component.html',
  styleUrls: ['./charts.timeline.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsTimelineComponent extends DashboardChartAbstract implements OnChanges, OnInit, OnDestroy, AfterViewInit {

  protected logger = Log.create('ChartColumnComponent');

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef) {
    super(zone, changeDetector);
  }

  async ngAfterViewInit() {
  }

  async ngOnInit() {
  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4plugins_timeline.SpiralChart>super.createChart(am4plugins_timeline.SpiralChart);
    chart.levelCount = 2;
    chart.inversed = true;
    chart.endAngle = -85;
    chart.yAxisInnerRadius = am4core.percent(10);
    chart.yAxisRadius = am4core.percent(100);
    chart.innerRadius = am4core.percent(45);
    chart.paddingTop = 0;
    chart.paddingBottom = 0;


    const categoryAxis = chart.yAxes.push(<am4charts.Axis<am4plugins_timeline.AxisRendererCurveY>>this.getCategoryAxis(this.chartDataCategoryType, this.chartDataDateRange));
    // categoryAxis.dataFields.category = 'time';
    if (categoryAxis instanceof am4charts.CategoryAxis) {
      categoryAxis.dataFields.category = 'type';
    } else if (categoryAxis instanceof am4charts.DateAxis) {
      categoryAxis.dataFields.date = 'time';
      chart.dateFormatter.dateFormat = categoryAxis.dateFormatter.dateFormat;
    }
    categoryAxis.renderer.grid.template.disabled = true;
    categoryAxis.renderer.minGridDistance = 1;
    categoryAxis.cursorTooltipEnabled = false;


    const categoryAxisLabelTemplate = categoryAxis.renderer.labels.template;
    categoryAxisLabelTemplate.paddingLeft = 20;
    categoryAxisLabelTemplate.horizontalCenter = 'left';
    categoryAxisLabelTemplate.adapter.add('rotation', (rotation, target) => {
      const position = valueAxis.valueToPosition(valueAxis.min);
      return valueAxis.renderer.positionToAngle(position) + 90;
    });
    categoryAxisLabelTemplate.adapter.add('text', (text, target, key) => {
      return `[bold font-size: 1.0em]${text}[/]`;
    });

    const valueAxis = chart.xAxes.push(<am4charts.ValueAxis<am4plugins_timeline.AxisRendererCurveX>>new am4charts.ValueAxis());
    valueAxis.renderer.minGridDistance = 100;

    // valueAxis.renderer.line.strokeDasharray = '1,0';
    // valueAxis.renderer.line.strokeOpacity = this.getStrokeOpacity();
    valueAxis.hidden = true;
    // valueAxis.renderer.line.strokeWidth = 0;
    // valueAxis.renderer.grid.template.disabled = true;
    valueAxis.zIndex = 100;
    valueAxis.cursorTooltipEnabled = false;
    valueAxis.min = 0;


    valueAxis.numberFormatter = new am4core.NumberFormatter();
    valueAxis.numberFormatter.numberFormat = `#`;
    // valueAxis.renderer.labels.template.adapter.add('text', (text, target) => {
    //   const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
    //   return `[bold font-size: 1.2em]${data.getDisplayValue()}[/]${data.getDisplayUnit()}[/]`
    // });

    const labelTemplate = valueAxis.renderer.labels.template;
    labelTemplate.verticalCenter = 'middle';
    labelTemplate.fillOpacity = this.getFillOpacity();

    const series = chart.series.push(new am4plugins_timeline.CurveColumnSeries());
    if (categoryAxis instanceof am4charts.CategoryAxis) {
      series.dataFields.categoryY = 'type';
    } else if (categoryAxis instanceof am4charts.DateAxis) {
      series.dataFields.dateY = 'time';
    }
    series.dataFields.valueX = 'value';


    series.columns.template.adapter.add('fill', (fill, target) => {
      return this.getFillColor(chart, target.dataItem.index);
    });
    series.columns.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext['value']);
      return `${'{dateY}{categoryY}'} ${target.dataItem.dataContext['count'] ? `(x${target.dataItem.dataContext['count']})` : ``} [bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b] (${this.chartDataValueType})`
    });


    const label = series.createChild(am4core.Label);
    label.horizontalCenter = 'middle';
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


    const cursor = new am4plugins_timeline.CurveCursor();
    chart.cursor = cursor;
    cursor.xAxis = valueAxis;
    cursor.yAxis = categoryAxis;
    cursor.lineY.disabled = true;
    cursor.lineX.strokeDasharray = '1,4';
    cursor.lineX.strokeOpacity = 1;


    return chart;
  }
}
