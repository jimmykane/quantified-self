import { NgModule } from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {DashboardRoutingModule} from '../dashboard-routing.module';
import {DashboardComponent} from '../components/dashboard/dashboard.component';
import {SummariesComponent} from '../components/summaries/summaries.component';
import {EventsExportFormComponent} from '../components/events-export-form/events-export.form.component';
import {EventTableComponent, MatPaginatorIntlFireStore} from '../components/event-table/event.table.component';
import {MatPaginatorIntl} from '@angular/material/paginator';
import { EventsMapComponent } from '../components/events-map/events-map.component';
import { AgmCoreModule } from '@agm/core';
import { TileChartComponent } from '../components/tile/chart/tile.chart.component';
import { TileMapComponent } from '../components/tile/map/tile.map.component';
import { TileChartActionsComponent } from '../components/tile/actions/chart/tile.chart.actions.component';
import { TileMapActionsComponent } from '../components/tile/actions/map/tile.map.actions.component';
import { ChartsBrianDevineComponent } from '../components/charts/brian-devine/charts.brian-devine.component';
import { ChartsTimelineComponent } from '../components/charts/timeline/charts.timeline.component';
import { ChartsPieComponent } from '../components/charts/pie/charts.pie.component';
import { ChartsXYComponent } from '../components/charts/xy/charts.xy.component';
import { ChartsColumnsComponent } from '../components/charts/columns/charts.columns.component';

@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    DashboardRoutingModule,
    AgmCoreModule,
    // If not used go away
  ],
  exports: [
  ],
  declarations: [
    DashboardComponent,
    SummariesComponent,
    TileChartActionsComponent,
    TileMapActionsComponent,
    EventsExportFormComponent,
    EventTableComponent,
    EventsMapComponent,
    TileChartComponent,
    TileMapComponent,
    ChartsTimelineComponent,
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsColumnsComponent,
    ChartsBrianDevineComponent,
  ],
  entryComponents: [],
  providers: [
    {provide: MatPaginatorIntl, useClass: MatPaginatorIntlFireStore},
  ],
})



export class DashboardModule { }
