import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ChartsColumnsComponent } from '../components/charts/columns/charts.columns.component';
import { ChartsKpiComponent } from '../components/charts/kpi/charts.kpi.component';
import { ChartsPieComponent } from '../components/charts/pie/charts.pie.component';
import { ChartRangeSelectorComponent } from '../components/charts/shared/chart-range-selector/chart-range-selector.component';
import { ChartsSleepTrendComponent } from '../components/charts/sleep-trend/charts.sleep-trend.component';
import { ChartsXYComponent } from '../components/charts/xy/charts.xy.component';
import { SharedModule } from './shared.module';
import { AppSignalChartsModule } from './app-signal-charts.module';

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    AppSignalChartsModule,
  ],
  declarations: [
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsColumnsComponent,
    ChartsKpiComponent,
    ChartsSleepTrendComponent,
    ChartRangeSelectorComponent,
  ],
  exports: [
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsColumnsComponent,
    ChartsKpiComponent,
    AppSignalChartsModule,
    ChartsSleepTrendComponent,
    ChartRangeSelectorComponent,
  ],
})
export class AppChartsModule { }
