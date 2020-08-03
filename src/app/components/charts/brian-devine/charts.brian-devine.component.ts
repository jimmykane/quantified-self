import {
  AfterViewInit,
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit, SimpleChanges,
  ViewChild,
} from '@angular/core';
import {Log} from 'ng2-logger/browser'
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import * as am4plugins_timeline from '@amcharts/amcharts4/plugins/timeline';

import {DynamicDataLoader} from '@sports-alliance/sports-lib/lib/data/data.store';
import {DashboardChartAbstract} from '../dashboard-chart.abstract';
import {SummariesChartDataInterface} from '../../summaries/summaries.component';
import {ChartHelper} from '../../event/chart/chart-helper';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib/lib/activities/activity.types';
import { ChartAbstractDirective } from '../chart-abstract.directive';

@Component({
  selector: 'app-brian-devine-chart',
  templateUrl: './charts.brian-devine.component.html',
  styleUrls: ['./charts.brian-devine.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsBrianDevineComponent extends DashboardChartAbstract implements OnChanges, OnDestroy {

  @Input() data: any;

  protected logger = Log.create('ChartsTimelineComponent');

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }


  protected createChart(): am4charts.XYChart {
    debugger
    const chart = <am4charts.RadarChart>super.createChart(am4charts.RadarChart);
    chart.innerRadius = am4core.percent(15);
    chart.radius = am4core.percent(90);
    // chart.data = weeklyData; // Add weekly
    chart.fontSize = '11px';
    chart.startAngle = 95;
    chart.endAngle = chart.startAngle + 350;
    // Create axes
    const dateAxis = chart.xAxes.push(<am4charts.DateAxis<am4charts.AxisRendererCircular>>new am4charts.DateAxis());
    dateAxis.baseInterval = { timeUnit: 'week', count: 1 };
    dateAxis.renderer.innerRadius = am4core.percent(40);
    dateAxis.renderer.minGridDistance = 5;
    dateAxis.renderer.labels.template.relativeRotation = 0;
    dateAxis.renderer.labels.template.location = 0.5;
    dateAxis.renderer.labels.template.radius = am4core.percent(-57);
    dateAxis.renderer.labels.template.fontSize = '8px';
    dateAxis.dateFormats.setKey('week', 'w');
    dateAxis.periodChangeDateFormats.setKey('week', 'w');
    dateAxis.cursorTooltipEnabled = false;

    const valueAxis = chart.yAxes.push(<am4charts.ValueAxis<am4charts.AxisRendererRadial>>new am4charts.ValueAxis());
    valueAxis.renderer.inversed = true;
    valueAxis.renderer.radius = am4core.percent(40);
    valueAxis.renderer.minGridDistance = 15;
    valueAxis.renderer.minLabelPosition = 0.05;
    valueAxis.renderer.axisAngle = 90;
    valueAxis.cursorTooltipEnabled = false;
    valueAxis.renderer.labels.template.fill = am4core.color('#ffffff');

    // weekday axis
    const weekDayAxis = chart.yAxes.push(<am4charts.CategoryAxis<am4charts.AxisRendererRadial>>new am4charts.CategoryAxis());
    weekDayAxis.dataFields.category = 'day';
    // weekDayAxis.data = dailyData;
    weekDayAxis.renderer.innerRadius = am4core.percent(50);
    weekDayAxis.renderer.minGridDistance = 10;
    weekDayAxis.renderer.grid.template.location = 0;
    weekDayAxis.renderer.line.disabled = true;
    weekDayAxis.renderer.axisAngle = 90;
    weekDayAxis.cursorTooltipEnabled = false;
    weekDayAxis.renderer.labels.template.fill = am4core.color('#ffffff');

    // add month ranges
    // const firstDay = new Date(data[0]["Activity Date"]);
    const firstDay = new Date('01-01-2020');

    for (let i = 0; i < 13; i++) {
      const range = dateAxis.axisRanges.create();
      range.date = new Date(firstDay.getFullYear(), i, 0, 0, 0, 0);
      range.endDate = new Date(firstDay.getFullYear(), i + 1, 0, 0, 0, 0);
      if (i % 2) {
        range.axisFill.fillOpacity = 0.4;
      } else {
        range.axisFill.fillOpacity = 0.8;
      }
      range.axisFill.radius = -28;
      range.axisFill.adapter.add('innerRadius', function(innerRadius, target) {
        return dateAxis.renderer.pixelRadius + 7;
      })
      range.axisFill.fill = am4core.color('#b9ce37');
      range.axisFill.stroke = am4core.color('#5f6062');
      range.grid.disabled = true;
      range.label.text = chart.dateFormatter.language.translate(chart.dateFormatter.months[i])
      range.label.bent = true;
      range.label.radius = 10;
      range.label.fontSize = 10;
      range.label.paddingBottom = 5;
      range.label.interactionsEnabled = false;
      range.axisFill.interactionsEnabled = true;
      range.axisFill.cursorOverStyle = am4core.MouseCursorStyle.pointer;
      range.axisFill.events.on('hit', function(event) {
        if (dateAxis.start == 0 && dateAxis.end == 1) {
          dateAxis.zoomToDates(event.target.dataItem.date, event.target.dataItem.endDate);
        } else {
          dateAxis.zoom({ start: 0, end: 1 });
        }
      })
    }



    return chart;
  }

  // ngOnChanges(changes: SimpleChanges) {
  // }
}
