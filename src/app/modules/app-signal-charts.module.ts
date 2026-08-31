import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChartsEfficiencyTrendComponent } from '../components/charts/efficiency-trend/charts.efficiency-trend.component';
import { ChartsFreshnessForecastComponent } from '../components/charts/freshness-forecast/charts.freshness-forecast.component';
import { ChartsFormComponent } from '../components/charts/form/charts.form.component';
import { ChartsIntensityDistributionComponent } from '../components/charts/intensity-distribution/charts.intensity-distribution.component';
import { ChartsPowerCurveComponent } from '../components/charts/power-curve/charts.power-curve.component';
import { AppChartSharedModule } from './app-chart-shared.module';

@NgModule({
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    AppChartSharedModule,
  ],
  declarations: [
    ChartsFormComponent,
    ChartsPowerCurveComponent,
    ChartsFreshnessForecastComponent,
    ChartsIntensityDistributionComponent,
    ChartsEfficiencyTrendComponent,
  ],
  exports: [
    ChartsFormComponent,
    ChartsPowerCurveComponent,
    ChartsFreshnessForecastComponent,
    ChartsIntensityDistributionComponent,
    ChartsEfficiencyTrendComponent,
  ],
})
export class AppSignalChartsModule { }
