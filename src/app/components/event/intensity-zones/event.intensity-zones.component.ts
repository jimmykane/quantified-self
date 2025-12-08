import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';

import { ActivityInterface } from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import { ChartAbstractDirective } from '../../charts/chart-abstract.directive';
import { DataHeartRate } from '@sports-alliance/sports-lib/lib/data/data.heart-rate';
import { DataPower } from '@sports-alliance/sports-lib/lib/data/data.power';
import { DataSpeed } from '@sports-alliance/sports-lib/lib/data/data.speed';
import { AppColors } from '../../../services/color/app.colors';
import { DynamicDataLoader } from '@sports-alliance/sports-lib/lib/data/data.store';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { convertIntensityZonesStatsToChartData } from '../../../helpers/intensity-zones-chart-data-helper';
import { AppDataColors } from '../../../services/color/app.data.colors';


@Component({
  selector: 'app-event-intensity-zones',
  templateUrl: './event.intensity-zones.component.html',
  styleUrls: ['./event.intensity-zones.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventIntensityZonesComponent extends ChartAbstractDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input() activities: ActivityInterface[];

  protected declare chart: am4charts.XYChart;

  private static getData(activities: ActivityInterface[]): any[] {
    return convertIntensityZonesStatsToChartData(activities)
  }


  constructor(protected zone: NgZone,
    changeDetector: ChangeDetectorRef,
    private eventColorService: AppEventColorService) {
    super(zone, changeDetector);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.chart) {
      if (changes.chartTheme || changes.useAnimations) {
        this.destroyChart();
        this.chart = this.createChart();
      }
      this.updateChart(EventIntensityZonesComponent.getData(this.activities));
    }
  }


  ngAfterViewInit(): void {
    this.chart = this.createChart();
    this.updateChart(EventIntensityZonesComponent.getData(this.activities));
  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);
    // chart.exporting.menu = this.getExportingMenu();
    chart.hiddenState.properties.opacity = 0;
    chart.padding(12, 0, 0, 0);

    // Legend
    const legend = new am4charts.Legend();
    chart.legend = legend;
    legend.parent = chart.plotContainer;
    legend.background.fill = am4core.color('#000');
    legend.background.fillOpacity = 0.00;
    legend.width = 100;
    legend.align = 'right';
    legend.valign = 'bottom';

    // X Axis
    const valueAxis = chart.xAxes.push(new am4charts.DurationAxis());
    valueAxis.renderer.grid.template.disabled = true;
    valueAxis.cursorTooltipEnabled = false;
    valueAxis.renderer.labels.template.disabled = true;
    valueAxis.extraMax = 0;

    // Y Axis
    const categoryAxis = chart.yAxes.push(new am4charts.CategoryAxis());
    // categoryAxis.renderer.grid.template.disabled = true;
    categoryAxis.renderer.grid.template.location = 0;
    categoryAxis.renderer.minGridDistance = 1;
    // categoryAxis.renderer.grid.template.strokeWidth = 2;
    // categoryAxis.renderer.grid.template.strokeOpacity = ;
    categoryAxis.cursorTooltipEnabled = false;
    categoryAxis.dataFields.category = 'zone';
    categoryAxis.renderer.labels.template.align = 'left';
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

    return chart;
  }

  private updateChart(data: any) {
    this.chart.series.clear();
    this.createChartSeries();
    this.chart.data = data
  }

  private createChartSeries() {
    DynamicDataLoader.zoneStatsTypeMap.forEach(statsTypeMap => {
      const series = this.chart.series.push(new am4charts.ColumnSeries());
      // series.clustered = false;
      series.dataFields.valueX = statsTypeMap.type;
      series.dataFields.categoryY = 'zone';
      series.calculatePercent = true;
      series.legendSettings.labelText = `${statsTypeMap.type}`;
      series.columns.template.tooltipText = `[bold font-size: 1.05em]{categoryY}[/]\n ${statsTypeMap.type}: [bold]{valueX.percent.formatNumber('#.')}%[/]\n Time: [bold]{valueX.formatDuration()}[/]`;
      series.columns.template.strokeWidth = 0;
      series.columns.template.height = am4core.percent(80);
      series.columns.template.column.cornerRadiusBottomRight = 8;
      series.columns.template.column.cornerRadiusTopRight = 8;

      const categoryLabel = series.bullets.push(new am4charts.LabelBullet());
      categoryLabel.label.adapter.add('text', (text, target) => {
        return `[bold]${Math.round(target.dataItem.values.valueX.percent)}[/]%`;
      });
      categoryLabel.label.horizontalCenter = 'left';
      categoryLabel.label.verticalCenter = 'middle';
      categoryLabel.label.truncate = false;
      categoryLabel.label.hideOversized = false;
      categoryLabel.label.fontSize = '0.75em';
      categoryLabel.label.dx = 10;
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
