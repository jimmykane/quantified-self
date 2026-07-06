import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ChartsColumnsComponent } from '../components/charts/columns/charts.columns.component';
import { ChartsEfficiencyTrendComponent } from '../components/charts/efficiency-trend/charts.efficiency-trend.component';
import { ChartsFreshnessForecastComponent } from '../components/charts/freshness-forecast/charts.freshness-forecast.component';
import { ChartsFormComponent } from '../components/charts/form/charts.form.component';
import { ChartsIntensityDistributionComponent } from '../components/charts/intensity-distribution/charts.intensity-distribution.component';
import { ChartsKpiComponent } from '../components/charts/kpi/charts.kpi.component';
import { ChartsPieComponent } from '../components/charts/pie/charts.pie.component';
import { ChartsPowerCurveComponent } from '../components/charts/power-curve/charts.power-curve.component';
import { ChartRangeSelectorComponent } from '../components/charts/shared/chart-range-selector/chart-range-selector.component';
import { ChartsSleepTrendComponent } from '../components/charts/sleep-trend/charts.sleep-trend.component';
import { ChartsXYComponent } from '../components/charts/xy/charts.xy.component';
import { SharedModule } from './shared.module';

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
  ],
  declarations: [
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsColumnsComponent,
    ChartsFormComponent,
    ChartsKpiComponent,
    ChartsPowerCurveComponent,
    ChartsFreshnessForecastComponent,
    ChartsIntensityDistributionComponent,
    ChartsEfficiencyTrendComponent,
    ChartsSleepTrendComponent,
    ChartRangeSelectorComponent,
  ],
  exports: [
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsColumnsComponent,
    ChartsFormComponent,
    ChartsKpiComponent,
    ChartsPowerCurveComponent,
    ChartsFreshnessForecastComponent,
    ChartsIntensityDistributionComponent,
    ChartsEfficiencyTrendComponent,
    ChartsSleepTrendComponent,
    ChartRangeSelectorComponent,
  ],
})
export class AppChartsModule { }
