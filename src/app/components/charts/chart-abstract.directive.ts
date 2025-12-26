import { ChangeDetectorRef, ElementRef, Input, NgZone, OnDestroy, ViewChild, Directive } from '@angular/core';
import * as Sentry from '@sentry/browser';
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
  @ViewChild('chartDiv', { static: true }) chartDiv: ElementRef;
  @ViewChild('legendDiv', { static: true }) legendDiv: ElementRef;

  @Input() chartTheme: ChartThemes = ChartThemes.Material;
  @Input() useAnimations: boolean;


  protected chart: am4charts.PieChart | am4charts.XYChart | am4charts.RadarChart;

  protected subscriptions: Subscription[] = [];

  // protected themes = {}; // Removed static themes map


  protected constructor(protected zone: NgZone, changeDetector: ChangeDetectorRef, protected amChartsService: AmChartsService, protected logger: LoggerService) {
    super(changeDetector);
  }

  protected async createChart(chartType?: any, data?: any): Promise<am4charts.Chart> {
    const { core, charts } = await this.amChartsService.load();

    // Config options set in service, but we can override or use core here
    return this.zone.runOutsideAngular(async () => {
      await this.setChartThemes(this.chartTheme, this.useAnimations, core);
      const chart = core.create(this.chartDiv.nativeElement, chartType || charts.XYChart) as am4charts.Chart;
      chart.preloader.disabled = true;

      // chart.pixelPerfect = true;
      // chart.colors.step = 2;
      // chart.padding(0,0,0,0)
      // chart.dataSource.updateCurrentData = true
      chart.exporting.useRetina = true; // access exporting via chart instance usually
      return chart;
    });
  }

  protected getExportingMenu(): any { // Returning any for now as types are hard without namespace
    // We need core to create ExportMenu but we don't have it synchronously here often
    // Best to instantiate in createChart or use chart.exporting.menu directly
    return null;
  }

  protected async setChartThemes(chartTheme: ChartThemes, useAnimations: boolean, am4core: typeof am4coretype) {
    am4core.unuseAllThemes();

    let themeModule;
    this.logger.log(`[Antigravity] Setting chart theme to: ${chartTheme}`);
    try {
      switch (chartTheme) {
        case 'material': themeModule = await import('@amcharts/amcharts4/themes/material'); break;
        case 'frozen': themeModule = await import('@amcharts/amcharts4/themes/frozen'); break;
        case 'dataviz': themeModule = await import('@amcharts/amcharts4/themes/dataviz'); break;
        case 'dark': themeModule = await import('@amcharts/amcharts4/themes/dark'); break;
        case 'amcharts': themeModule = await import('@amcharts/amcharts4/themes/amcharts'); break;
        case 'amchartsdark': themeModule = await import('@amcharts/amcharts4/themes/amchartsdark'); break;
        case 'moonrisekingdom': themeModule = await import('@amcharts/amcharts4/themes/moonrisekingdom'); break;
        case 'spiritedaway': themeModule = await import('@amcharts/amcharts4/themes/spiritedaway'); break;
        case 'kelly': themeModule = await import('@amcharts/amcharts4/themes/kelly'); break;
        default:
          this.logger.warn(`[Antigravity] Unknown theme '${chartTheme}', defaulting to material.`);
          themeModule = await import('@amcharts/amcharts4/themes/material');
          break;
      }

      if (themeModule && themeModule.default) {
        this.logger.log(`[Antigravity] Applying theme module for ${chartTheme}`);
        am4core.useTheme(themeModule.default);
      } else {
        this.logger.error(`[Antigravity] Theme module for ${chartTheme} did not load correctly.`, themeModule);
      }
    } catch (e) {
      this.logger.error(`[Antigravity] Error loading theme ${chartTheme}:`, e);
    }

    // Programmatically enforce dark tooltip styles for dark themes to prevent "white on white" issues
    if (chartTheme === 'dark' || chartTheme === 'amchartsdark') {
      const customDarkTooltipTheme = (target: any) => {
        if (target instanceof am4core.Tooltip) {
          if (target.background) {
            target.background.fill = am4core.color("#303030");
            target.background.stroke = am4core.color("#303030");
          }
          if (target.label) {
            target.label.fill = am4core.color("#ffffff");
          }
          target.getFillFromObject = false;
        }
      };
      am4core.useTheme(customDarkTooltipTheme);
    }

    if (useAnimations === true) {
      const animated = await import('@amcharts/amcharts4/themes/animated');
      am4core.useTheme(animated.default);
    }
  }

  protected async destroyChart() {
    try {
      const { core } = await this.amChartsService.load();
      this.zone.runOutsideAngular(() => {
        // We need core to unuse themes, but strictly we just need to dispose the chart object which we have
        // But to be safe let's load core if we want to unuseAllThemes
        core.unuseAllThemes();
        if (this.chart) {
          this.chart.dispose();
          // delete this.chart

        }
      });
    } catch (e) {

      // Log to Sentry
      Sentry.captureException(e);
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
