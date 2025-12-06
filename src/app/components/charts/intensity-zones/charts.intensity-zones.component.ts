import { ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone, OnChanges, OnDestroy } from '@angular/core';

import * as am4core from '@amcharts/amcharts4/core';
import { percent } from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';
import { XYChart } from '@amcharts/amcharts4/charts';
import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { DashboardChartAbstractDirective } from '../dashboard-chart-abstract-component.directive';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { AppDataColors } from '../../../services/color/app.data.colors';


@Component({
    selector: 'app-intensity-zones-chart',
    templateUrl: './charts.intensity-zones.component.html',
    styleUrls: ['./charts.intensity-zones.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ChartsIntensityZonesComponent extends DashboardChartAbstractDirective implements OnChanges, OnDestroy {

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);
    chart.hiddenState.properties.opacity = 0;
    chart.padding(0, 0, 0, 0);

    // Legend
    const legend = new am4charts.Legend();
    chart.legend = legend;
    legend.parent = chart.plotContainer;
    legend.background.fill = am4core.color('#000');
    legend.background.fillOpacity = 0.00;
    legend.width = percent(100);
    legend.align = 'center';
    legend.valign = 'top';

    // Y Axis
    const valueAxis = chart.yAxes.push(new am4charts.DurationAxis());
    valueAxis.renderer.grid.template.disabled = true;
    valueAxis.cursorTooltipEnabled = false;
    valueAxis.renderer.labels.template.disabled = true;
    valueAxis.extraMax = 0;

    // X Axis
    const categoryAxis = chart.xAxes.push(new am4charts.CategoryAxis());
    // categoryAxis.renderer.grid.template.disabled = true;
    categoryAxis.renderer.grid.template.location = 0;
    categoryAxis.renderer.minGridDistance = 1;
    // categoryAxis.renderer.grid.template.strokeWidth = 2;
    // categoryAxis.renderer.grid.template.strokeOpacity = ;
    categoryAxis.cursorTooltipEnabled = false;
    categoryAxis.dataFields.category = 'zone';
    // categoryAxis.renderer.labels.template.align = 'left';
    // categoryAxis.renderer.labels.template.fontWeight = 'bold';
    categoryAxis.renderer.cellStartLocation = 0.05;
    categoryAxis.renderer.cellEndLocation = 0.95;
    categoryAxis.renderer.grid.template.disabled = true
    // categoryAxis.renderer.grid.template.fillOpacity = 1;
    // categoryAxis.renderer.grid.template.fill = am4core.color('FFFFFF');

    categoryAxis.renderer.axisFills.template.disabled = false;
    categoryAxis.renderer.axisFills.template.fillOpacity = 0.1;
    categoryAxis.fillRule = (dataItem) => {
      dataItem.axisFill.visible = true;
    };
    categoryAxis.renderer.axisFills.template.adapter.add('fill', (fill, target) => {
      return target.dataItem && target.dataItem.dataContext ? this.eventColorService.getColorForZone(target.dataItem.dataContext['zone']) : null;
    });
    this.createChartSeries(chart);
    return chart;
  }

  private createChartSeries(chart: XYChart) {
    DynamicDataLoader.zoneStatsTypeMap.forEach(statsTypeMap => {
      const series = chart.series.push(new am4charts.ColumnSeries());
      // series.clustered = false;
      series.dataFields.valueY = statsTypeMap.type;
      series.dataFields.categoryX = 'zone';
      series.calculatePercent = true;
      series.legendSettings.labelText = `${statsTypeMap.type}`;
      series.columns.template.tooltipText = `[bold font-size: 1.05em]{categoryX}[/]\n ${statsTypeMap.type}: [bold]{valueY.percent.formatNumber('#.')}%[/]\n Time: [bold]{valueY.formatDuration()}[/]`;
      series.columns.template.strokeWidth = 0;
      series.columns.template.height = am4core.percent(90);
      series.columns.template.width = am4core.percent(40);
      series.columns.template.column.cornerRadiusTopRight = 8;
      series.columns.template.column.cornerRadiusTopLeft = 8;

      const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
      categoryLabel.label.adapter.add('text', (text, target) => {
        return `[bold]${Math.round(target.dataItem.values.valueY.percent)}[/]%`;
      });
      categoryLabel.label.horizontalCenter = 'middle';
      // categoryLabel.label.verticalCenter = 'top';
      categoryLabel.label.truncate = false;
      categoryLabel.label.hideOversized = false;
      categoryLabel.label.fontSize = '0.75em';
      categoryLabel.label.dy = -10;
      categoryLabel.label.padding(1, 2, 0, 2);

      categoryLabel.label.background = new am4core.RoundedRectangle();
      categoryLabel.label.background.fillOpacity = 1;
      categoryLabel.label.background.strokeOpacity = 1;
      categoryLabel.label.background.adapter.add('stroke', (stroke, target) => {
        return target.dataItem && target.dataItem.dataContext ? this.eventColorService.getColorForZone(target.dataItem.dataContext['zone']) : null;
      });
      // (<am4core.RoundedRectangle>(categoryLabel.label.background)).cornerRadius(2, 2, 2, 2);

      series.fill = am4core.color(AppDataColors[statsTypeMap.type]);
    });
  }
}
