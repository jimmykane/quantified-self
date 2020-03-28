import {
  AfterViewInit,
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit, SimpleChanges,
} from '@angular/core';
import {Log} from 'ng2-logger/browser'
import * as am4core from '@amcharts/amcharts4/core';
import * as am4charts from '@amcharts/amcharts4/charts';

import {ActivityInterface} from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import {ChartAbstractDirective} from '../../charts/chart-abstract.directive';
import {IntensityZonesInterface} from '@sports-alliance/sports-lib/lib/intensity-zones/intensity-zones.interface';
import {IntensityZones} from '@sports-alliance/sports-lib/lib/intensity-zones/intensity-zones';
import {DataHeartRate} from '@sports-alliance/sports-lib/lib/data/data.heart-rate';
import {DataPower} from '@sports-alliance/sports-lib/lib/data/data.power';
import {DataSpeed} from '@sports-alliance/sports-lib/lib/data/data.speed';
import {ChartHelper} from '../chart/chart-helper';
import {AppColors} from '../../../services/color/app.colors';
import {MatIconRegistry} from '@angular/material/icon';


@Component({
  selector: 'app-event-intensity-zones',
  templateUrl: './event.intensity-zones.component.html',
  styleUrls: ['./event.intensity-zones.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventIntensityZonesComponent extends ChartAbstractDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input() activities: ActivityInterface[];

  intensityZones: IntensityZonesInterface[] = [
    new IntensityZones(DataHeartRate.type),
    new IntensityZones(DataPower.type),
    new IntensityZones(DataSpeed.type),
  ];

  protected chart: am4charts.XYChart;
  protected logger = Log.create('EventIntensityZonesComponent');

  constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, private matIconRegistry: MatIconRegistry) {
    super(zone, changeDetector);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.chart) {
      if (changes.chartTheme || changes.useAnimations) {
        this.destroyChart();
        this.chart = this.createChart();
      }
      this.updateIntensityZones();
      this.updateChart();
    }
  }


  ngAfterViewInit(): void {
    this.chart = this.createChart();
    this.updateIntensityZones();
    this.updateChart();
  }

  protected createChart(): am4charts.XYChart {
    const chart = <am4charts.XYChart>super.createChart(am4charts.XYChart);
    // Disable the preloader
    chart.preloader.disabled = true;
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
    categoryAxis.renderer.grid.template.location = -1;
    categoryAxis.renderer.minGridDistance = 1;
    // categoryAxis.renderer.grid.template.strokeWidth = 2;
    // categoryAxis.renderer.grid.template.strokeOpacity = ;
    categoryAxis.cursorTooltipEnabled = false;
    categoryAxis.dataFields.category = 'zone';
    categoryAxis.renderer.labels.template.align = 'left';
    // categoryAxis.renderer.labels.template.fontWeight = 'bold';
    categoryAxis.renderer.cellStartLocation = 0.05;
    categoryAxis.renderer.cellEndLocation = 0.95;
    categoryAxis.renderer.grid.template.fillOpacity = 1;
    categoryAxis.renderer.grid.template.fill = am4core.color('FFFFFF');

    // categoryAxis.renderer.axisFills.template.disabled = false;
    // categoryAxis.renderer.axisFills.template.fillOpacity = 0.4;
    // categoryAxis.fillRule = (dataItem) => {
    //   dataItem.axisFill.visible = true;
    // };
    // categoryAxis.renderer.axisFills.template.adapter.add('fill', (fill, target) => {
    //   return target.dataItem && target.dataItem.dataContext ? this.getColorForZone(target.dataItem.dataContext['zone']) : null;
    // });

    return chart;
  }

  private updateIntensityZones() {
    this.intensityZones.forEach(intensityZones => {
      intensityZones.zone1Duration = null;
      intensityZones.zone2Duration = null;
      intensityZones.zone3Duration = null;
      intensityZones.zone4Duration = null;
      intensityZones.zone5Duration = null;
      intensityZones.zone2LowerLimit = null;
      intensityZones.zone3LowerLimit = null;
      intensityZones.zone4LowerLimit = null;
      intensityZones.zone5LowerLimit = null;
      this.activities.forEach(activity => {
        const activityIntensityZone = activity.intensityZones.find(iz => iz.type === intensityZones.type);
        if (!activityIntensityZone) {
          return
        }

        intensityZones.zone1Duration = intensityZones.zone1Duration || 0;
        intensityZones.zone2Duration = intensityZones.zone2Duration || 0;
        intensityZones.zone3Duration = intensityZones.zone3Duration || 0;
        intensityZones.zone4Duration = intensityZones.zone4Duration || 0;
        intensityZones.zone5Duration = intensityZones.zone5Duration || 0;
        intensityZones.zone1Duration += activityIntensityZone.zone1Duration;
        intensityZones.zone2Duration += activityIntensityZone.zone2Duration;
        intensityZones.zone3Duration += activityIntensityZone.zone3Duration;
        intensityZones.zone4Duration += activityIntensityZone.zone4Duration;
        intensityZones.zone5Duration += activityIntensityZone.zone5Duration;

        intensityZones.zone2LowerLimit = intensityZones.zone2LowerLimit || activityIntensityZone.zone2LowerLimit;
        intensityZones.zone3LowerLimit = intensityZones.zone3LowerLimit || activityIntensityZone.zone3LowerLimit;
        intensityZones.zone4LowerLimit = intensityZones.zone4LowerLimit || activityIntensityZone.zone4LowerLimit;
        intensityZones.zone5LowerLimit = intensityZones.zone5LowerLimit || activityIntensityZone.zone5LowerLimit;
      });
    });
  }

  private updateChart() {
    this.chart.series.clear();
    this.createChartSeries();
    this.chart.data = this.intensityZones.reduce((data, intensityZones) => {
      data.push({
        zone: `Zone 1`,
        [intensityZones.type]: intensityZones.zone1Duration,
      }, {
        zone: `Zone 2`,
        [intensityZones.type]: intensityZones.zone2Duration,
      }, {
        zone: `Zone 3`,
        [intensityZones.type]: intensityZones.zone3Duration,
      }, {
        zone: `Zone 4`,
        [intensityZones.type]: intensityZones.zone4Duration,
      }, {
        zone: `Zone 5`,
        [intensityZones.type]: intensityZones.zone5Duration,
      });
      return data;
    }, []);
  }

  private getColorForZone(zone: string): am4core.Color {
    switch (zone) {
      case `Zone 5`:
        return am4core.color(AppColors.Red);
      case `Zone 4`:
        return am4core.color(AppColors.Orange);
      case `Zone 3`:
        return am4core.color(AppColors.Yellow);
      case `Zone 2`:
        return am4core.color(AppColors.Green);
      case `Zone 1`:
      default:
        return am4core.color(AppColors.Blue);
    }
  }

  private createChartSeries() {
    this.intensityZones.forEach(intensityZone => {
      if (!intensityZone.zone1Duration
        && !intensityZone.zone2Duration
        && !intensityZone.zone3Duration
        && !intensityZone.zone4Duration
        && !intensityZone.zone5Duration) {
        return;
      }
      const series = this.chart.series.push(new am4charts.ColumnSeries());
      // series.clustered = false;
      series.dataFields.valueX = intensityZone.type;
      series.dataFields.categoryY = 'zone';
      series.calculatePercent = true;
      series.legendSettings.labelText = `${intensityZone.type}`;
      series.columns.template.tooltipText = `[bold font-size: 1.05em]{categoryY}[/]\n ${intensityZone.type}: [bold]{valueX.percent.formatNumber('#.')}%[/]\n Time: [bold]{valueX.formatDuration()}[/]`;
      series.columns.template.strokeWidth = 0;
      series.columns.template.height = am4core.percent(80);
      series.columns.template.column.cornerRadiusBottomRight = 2;
      series.columns.template.column.cornerRadiusTopRight = 2;

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
        return target.dataItem && target.dataItem.dataContext ? this.getColorForZone(target.dataItem.dataContext['zone']) : null;
      });
      // (<am4core.RoundedRectangle>(categoryLabel.label.background)).cornerRadius(2, 2, 2, 2);


      switch (intensityZone.type) {
        case DataHeartRate.type:
          series.fill = am4core.color(AppColors.Red);
          break;
        case DataPower.type:
          series.fill = am4core.color(AppColors.Orange);
          break;
        case DataSpeed.type:
          series.fill = am4core.color(AppColors.Blue);
          break;
      }
      // series.cursorTooltipEnabled = false;
    });
  }
}
