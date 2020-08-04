import { NgModule } from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {DashboardRoutingModule} from '../dashboard-routing.module';
import {DashboardComponent} from '../components/dashboard/dashboard.component';
import {SummariesComponent} from '../components/summaries/summaries.component';
import {EventSearchComponent} from '../components/event-search/event-search.component';
import {EventsExportFormComponent} from '../components/events-export-form/events-export.form.component';
import {EventTableComponent, MatPaginatorIntlFireStore} from '../components/event-table/event.table.component';
import {MatPaginatorIntl} from '@angular/material/paginator';
import { EventsMapComponent } from '../components/events-map/events-map.component';
import { AgmCoreModule } from '@agm/core';
import { TileChartComponent } from '../components/tile/chart/tile.chart.component';
import { TileMapComponent } from '../components/tile/map/tile.map.component';
import { TileChartActionsComponent } from '../components/tile/actions/chart/tile.chart.actions.component';
import { TileMapActionsComponent } from '../components/tile/actions/map/tile.map.actions.component';
import { ActivityTypesMultiSelectComponent } from '../components/activity-types-multi-select/activity-types-multi-select.component';
import {MAT_MOMENT_DATE_FORMATS, MomentDateAdapter} from '@angular/material-moment-adapter';
import {DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE} from '@angular/material/core';
import { ChartsBrianDevineComponent } from '../components/charts/brian-devine/charts.brian-devine.component';
import { ChartsTimelineComponent } from '../components/charts/timeline/charts.timeline.component';
import { ChartsPieComponent } from '../components/charts/pie/charts.pie.component';
import { ChartsXYComponent } from '../components/charts/xy/charts.xy.component';

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
    EventSearchComponent,
    EventsExportFormComponent,
    EventTableComponent,
    EventsMapComponent,
    TileChartComponent,
    TileMapComponent,
    ActivityTypesMultiSelectComponent,
    ChartsTimelineComponent,
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsBrianDevineComponent,
  ],
  entryComponents: [],
  providers: [
    {provide: MatPaginatorIntl, useClass: MatPaginatorIntlFireStore},
    // @todo get it from settings as a service perhaps
    {provide: MAT_DATE_LOCALE, useValue: window.navigator.languages
        ? window.navigator.languages[0]
        : window.navigator['userLanguage'] || window.navigator.language},
    {provide: DateAdapter, useClass: MomentDateAdapter, deps: [MAT_DATE_LOCALE]},
    {provide: MAT_DATE_FORMATS, useValue: MAT_MOMENT_DATE_FORMATS},
  ],
})



export class DashboardModule { }
