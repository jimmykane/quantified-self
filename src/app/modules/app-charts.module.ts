import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ChartsColumnsComponent } from '../components/charts/columns/charts.columns.component';
import { ChartsFormComponent } from '../components/charts/form/charts.form.component';
import { ChartsPieComponent } from '../components/charts/pie/charts.pie.component';
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
  ],
  exports: [
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsColumnsComponent,
    ChartsFormComponent,
  ],
})
export class AppChartsModule { }
