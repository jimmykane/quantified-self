import { ChangeDetectionStrategy, ChangeDetectorRef, Component, NgZone, OnChanges, OnDestroy } from '@angular/core';

import type * as am4core from '@amcharts/amcharts4/core';
import type * as am4charts from '@amcharts/amcharts4/charts';

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

  private _am4core: typeof am4core;
  private _am4charts: typeof am4charts;

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  protected async createChart(): Promise<am4charts.XYChart> {
    const { am4core, am4charts } = await this.loadAmCharts();
    this._am4core = am4core;
    this._am4charts = am4charts;
    const chart = <am4charts.XYChart>(await super.createChart(am4charts.XYChart));
    chart.hiddenState.properties.opacity = 0;
    chart.padding(0, 0, 0, 0);

    // Legend
    const legend = new this._am4charts.Legend();
    chart.legend = legend;
    legend.parent = chart.plotContainer;
    legend.background.fill = this._am4core.color('#000');
    legend.background.fillOpacity = 0.00;
    legend.width = this._am4core.percent(100);
    legend.align = 'center';
    legend.valign = 'top';

    // Y Axis
    const valueAxis = chart.yAxes.push(new this._am4charts.DurationAxis());
    valueAxis.renderer.grid.template.disabled = true;
    valueAxis.cursorTooltipEnabled = false;
    valueAxis.renderer.labels.template.disabled = true;
    valueAxis.extraMax = 0;

    // X Axis
    const categoryAxis = chart.xAxes.push(new this._am4charts.CategoryAxis());
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
    // categoryAxis.renderer.grid.template.fill = this._am4core.color('FFFFFF');

    categoryAxis.renderer.axisFills.template.disabled = false;
    categoryAxis.renderer.axisFills.template.fillOpacity = 0.1;
    categoryAxis.fillRule = (dataItem) => {
      dataItem.axisFill.visible = true;
    };
    categoryAxis.renderer.axisFills.template.adapter.add('fill', (fill, target) => {
      return target.dataItem && target.dataItem.dataContext ? this.eventColorService.getColorForZone(target.dataItem.dataContext['zone']) : null;
    });
    this.createChartSeries(chart, this._am4core, this._am4charts);
    return chart;
  }

  private createChartSeries(chart: am4charts.XYChart, amCore: typeof am4core, amCharts: typeof am4charts) {
    DynamicDataLoader.zoneStatsTypeMap.forEach(statsTypeMap => {
      const series = chart.series.push(new amCharts.ColumnSeries());
      // series.clustered = false;
      series.dataFields.valueY = statsTypeMap.type;
      series.dataFields.categoryX = 'zone';
      series.calculatePercent = true;
      series.legendSettings.labelText = `${statsTypeMap.type}`;
      series.columns.template.tooltipText = `[bold font-size: 1.05em]{categoryX}[/]\n ${statsTypeMap.type}: [bold]{valueY.percent.formatNumber('#.')}%[/]\n Time: [bold]{valueY.formatDuration()}[/]`;
      series.columns.template.strokeWidth = 0;
      series.columns.template.height = amCore.percent(90);
      series.columns.template.width = amCore.percent(40);
      series.columns.template.column.cornerRadiusTopRight = 8;
      series.columns.template.column.cornerRadiusTopLeft = 8;

      const categoryLabel = series.bullets.push(new amCharts.LabelBullet());
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

      categoryLabel.label.background = new amCore.RoundedRectangle();
      categoryLabel.label.background.fillOpacity = 1;
      categoryLabel.label.background.strokeOpacity = 1;
      categoryLabel.label.background.adapter.add('stroke', (stroke, target) => {
        return target.dataItem && target.dataItem.dataContext ? this.eventColorService.getColorForZone(target.dataItem.dataContext['zone']) : null;
      });
      // (<am4core.RoundedRectangle>(categoryLabel.label.background)).cornerRadius(2, 2, 2, 2);

      series.fill = amCore.color(AppDataColors[statsTypeMap.type]);
    });
  }
}
