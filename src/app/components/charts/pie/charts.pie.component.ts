import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  NgZone,
  OnChanges,
  OnDestroy,
} from '@angular/core';

import { AmChartsService } from '../../../services/am-charts.service';

// Type-only imports
import type * as am4core from '@amcharts/amcharts4/core';
import type * as am4charts from '@amcharts/amcharts4/charts';
import type * as am4plugins_sliceGrouper from '@amcharts/amcharts4/plugins/sliceGrouper';

import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import * as Sentry from '@sentry/browser';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes
} from '@sports-alliance/sports-lib';
import { DashboardChartAbstractDirective } from '../dashboard-chart-abstract-component.directive';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../../services/logger.service';


@Component({
  selector: 'app-pie-chart',
  templateUrl: './charts.pie.component.html',
  styleUrls: ['./charts.pie.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ChartsPieComponent extends DashboardChartAbstractDirective implements OnChanges, OnDestroy {



  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private eventColorService: AppEventColorService, protected amChartsService: AmChartsService, protected logger: LoggerService) {
    super(zone, changeDetector, amChartsService, logger);
  }

  protected async createChart(): Promise<am4charts.PieChart> {
    const { core, charts } = await this.amChartsService.load();
    const sliceGrouper = await import('@amcharts/amcharts4/plugins/sliceGrouper');

    const chart = await super.createChart(charts.PieChart) as am4charts.PieChart;
    chart.fontSize = '0.8em'
    // chart.hiddenState.properties.opacity = 0;
    chart.padding(0, 5, 0, 5);
    chart.radius = core.percent(55);
    chart.innerRadius = core.percent(45);

    const pieSeries = chart.series.push(new charts.PieSeries());
    pieSeries.dataFields.value = this.chartDataValueType;
    pieSeries.dataFields.category = this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? 'type' : 'time';
    // pieSeries.interpolationDuration = 500;f
    // pieSeries.rangeChangeDuration = 500;
    // pieSeries.sequencedInterpolation = true;

    // pieSeries.slices.template.propertyFields.isActive = 'pulled';
    pieSeries.slices.template.strokeWidth = 0.4;
    pieSeries.slices.template.strokeOpacity = 1;
    pieSeries.slices.template.stroke = core.color('#175e84');
    // pieSeries.slices.template.filters.push(ChartHelper.getShadowFilter());

    pieSeries.slices.template.adapter.add('tooltipText', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.values || !target.dataItem.dataContext) {
        return '';
      }
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[this.chartDataValueType]);
      return `{category${this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? `` : `.formatDate("${this.getChartDateFormat(this.chartDataTimeInterval)}")`}}\n${target.dataItem.values.value.percent.toFixed(1)}%\n[bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]\n${target.dataItem.dataContext['count'] ? `${target.dataItem.dataContext['count']} Activities` : ``}`
    });

    pieSeries.slices.template.adapter.add('fill', (fill, target, key) => {
      if (this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
        return core.color(this.eventColorService.getColorForActivityTypeByActivityTypeGroup(ActivityTypes[target.dataItem.dataContext['type']]))
      }
      return this.getFillColor(chart, target.dataItem.index);
    });

    pieSeries.labels.template.adapter.add('text', (text, target, key) => {
      if (!target.dataItem || !target.dataItem.values || !target.dataItem.dataContext) {
        return '';
      }
      try {
        const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, target.dataItem.dataContext[this.chartDataValueType]);
        return `[font-size: 1.1em]${this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? target.dataItem.dataContext.type.slice(0, 40) : `{category.formatDate("${this.getChartDateFormat(this.chartDataTimeInterval)}")}`}[/]\n[bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
        // return `[bold font-size: 1.2em]{value.percent.formatNumber('#.')}%[/] [font-size: 1.1em]${this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType ? target.dataItem.dataContext.type.slice(0, 40) : `{category.formatDate('${this.getChartDateFormat(this.chartDataDateRange)}')}` || 'other'}[/]\n[bold]${data.getDisplayValue()}${data.getDisplayUnit()}[/b]`
      } catch (e) {
        Sentry.captureException(e);
      }
    });

    pieSeries.labels.template.wrap = true
    pieSeries.labels.template.maxWidth = 70

    const label = pieSeries.createChild(core.Label);
    label.horizontalCenter = 'middle';
    label.verticalCenter = 'middle';
    // label.fontSize = 12;
    if (this.chartDataValueType === ChartDataValueTypes.Total) {
      label.text = `{values.value.sum.formatNumber('#')}`;
    }
    if (this.chartDataValueType === ChartDataValueTypes.Maximum) {
      label.text = `{values.value.high.formatNumber('#')}`;
    }
    if (this.chartDataValueType === ChartDataValueTypes.Minimum) {
      label.text = `{values.value.low.formatNumber('#')}`;
    }
    if (this.chartDataValueType === ChartDataValueTypes.Average) {
      label.text = `{values.value.average.formatNumber('#')}`;
    }
    label.adapter.add('textOutput', (text, target, key) => {
      const data = DynamicDataLoader.getDataInstanceFromDataType(this.chartDataType, Number(text));
      return `[font-size: 1.2em]${data.getDisplayType()}[/]
              [font-size: 1.3em]${data.getDisplayValue()}${data.getDisplayUnit()}[/]
              [font-size: 0.9em]${this.chartDataValueType}[/]`
    });

    // chart.exporting.menu = this.getExportingMenu();

    if (this.chartDataCategoryType === ChartDataCategoryTypes.ActivityType) {
      const grouper = pieSeries.plugins.push(new sliceGrouper.SliceGrouper());
      grouper.threshold = 7;
      grouper.groupName = 'Other';
      grouper.clickBehavior = 'zoom';
      grouper.zoomOutButton.align = 'left';
      grouper.zoomOutButton.width = 35;
      grouper.zoomOutButton.valign = 'top';
    }

    return chart;
  }
}
