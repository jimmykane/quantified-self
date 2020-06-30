import { NgModule } from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {DashboardRoutingModule} from '../dashboard-routing.module';
import {DashboardComponent} from '../components/dashboard/dashboard.component';
import {SummariesComponent} from '../components/summaries/summaries.component';
import {EventSearchComponent} from '../components/event-search/event-search.component';
import {EventsExportFormComponent} from '../components/events-export-form/events-export.form.component';
import {UploadActivitiesComponent} from '../components/upload/upload-activities/upload-activities.component';
import {EventTableComponent, MatPaginatorIntlFireStore} from '../components/event-table/event.table.component';
import {MatPaginatorIntl} from '@angular/material/paginator';
import { EventsMapComponent } from '../components/events-map/events-map.component';
import { AgmCoreModule } from '@agm/core';
import { TileChartComponent } from '../components/tile/chart/tile.chart.component';
import { TileMapComponent } from '../components/tile/map/tile.map.component';
import { TileChartActionsComponent } from '../components/tile/actions/chart/tile.chart.actions.component';
import { TileMapActionsComponent } from '../components/tile/actions/map/tile.map.actions.component';
import { DateAdapter } from '@angular/material/core';
import { MondayDateAdapter } from '../adapters/date.adapter';
import { ActivityTypesMultiSelectComponent } from '../components/activity-types-multi-select/activity-types-multi-select.component';

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
  ],
  entryComponents: [],
  providers: [
    {provide: MatPaginatorIntl, useClass: MatPaginatorIntlFireStore},
    // @todo get it from settings as a service perhaps
    {provide: DateAdapter, useClass: MondayDateAdapter},
  ],
})



export class DashboardModule { }
