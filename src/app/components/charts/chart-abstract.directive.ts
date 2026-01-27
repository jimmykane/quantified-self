import { ChangeDetectorRef, ElementRef, Input, NgZone, OnDestroy, ViewChild, Directive } from '@angular/core';
import { Subscription } from 'rxjs';
import { DataPaceMinutesPerMile, DataPace } from '@sports-alliance/sports-lib';
import { ChartThemes } from '@sports-alliance/sports-lib';


// Chart Themes
import { AmChartsService } from '../../services/am-charts.service';
import type * as am4charts from '@amcharts/amcharts4/charts';
import type * as am4coretype from '@amcharts/amcharts4/core';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';
import { LoggerService } from '../../services/logger.service';


// @todo should dectate to implement on screen change
@Directive()
export abstract class ChartAbstractDirective extends LoadingAbstractDirective implements OnDestroy {
  @ViewChild('chartDiv', { static: true }) chartDiv!: ElementRef;
  @ViewChild('legendDiv', { static: true }) legendDiv!: ElementRef;

  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() useAnimations!: boolean;


  protected chart: am4charts.PieChart | am4charts.XYChart | am4charts.RadarChart | undefined;

  protected subscriptions: Subscription[] = [];

  // protected themes = {}; // Removed static themes map


  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected amChartsService: AmChartsService, protected logger: LoggerService) {
    super(changeDetector);
  }

  protected async createChart(chartType?: any, data?: any): Promise<am4charts.Chart> {
    const { core, charts } = await this.amChartsService.load();

    // Config options set in service, but we can override or use core here
    return this.zone.runOutsideAngular(async () => {
      await this.amChartsService.setChartTheme(this.chartTheme, this.useAnimations);
      if (this.chart) {
        this.chart.dispose();
      }
      const chart = core.create(this.chartDiv.nativeElement, chartType || charts.XYChart) as am4charts.Chart;
      chart.fontFamily = "'Barlow Condensed', sans-serif";
      if (chart.preloader) {
        chart.preloader.disabled = true;
      }

      // chart.pixelPerfect = true;
      // chart.colors.step = 2;
      // chart.padding(0,0,0,0)
      // chart.dataSource.updateCurrentData = true
      chart.exporting.useRetina = true; // access exporting via chart instance usually
      core.options.minPolylineStep = 2;
      return chart;
    });
  }

  protected getExportingMenu(): any { // Returning any for now as types are hard without namespace
    // We need core to create ExportMenu but we don't have it synchronously here often
    // Best to instantiate in createChart or use chart.exporting.menu directly
    return null;
  }



  protected async destroyChart() {
    try {
      this.zone.runOutsideAngular(() => {
        if (this.chart) {
          this.chart.dispose();
          this.chart = undefined;
        }
      });
    } catch (e) {

      this.logger.error(e);
    }
  }



  getFillColor(chart: am4charts.XYChart | am4charts.PieChart, index: number) {
    return chart.colors.getIndex(index * 2);
  }

  getFillOpacity() {
    return 0.8
  }

  getStrokeOpacity() {
    return 1;
  }

  getStrokeWidth() {
    return 0.4;
  }

  ngOnDestroy() {
    this.destroyChart();
  }

}
