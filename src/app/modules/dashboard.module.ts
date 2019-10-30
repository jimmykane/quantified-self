import { NgModule } from '@angular/core';
import {MaterialModule} from './material.module';
import {SharedModule} from './shared.module';
import {CommonModule} from '@angular/common';
import {DashboardRoutingModule} from '../dashboard-routing.module';
import {DashboardComponent} from '../components/dashboard/dashboard.component';
import {UploadInfoComponent} from '../components/upload-info/upload-info.component';
import {ChartsPieComponent} from '../components/charts/pie/charts.pie.component';
import {ChartsXYComponent} from '../components/charts/xy/charts.xy.component';
import {SummariesComponent} from '../components/summaries/summaries.component';
import {ChartActionsComponent} from '../components/charts/actions/chart.actions.component';
import {EventSearchComponent} from '../components/event-search/event-search.component';
import {EventsExportFormComponent} from '../components/events-export-form/events-export.form.component';
import {ChartsTimelineComponent} from '../components/charts/timeline/charts.timeline.component';
import {EditInputComponent} from '../components/edit-input/edit-input.component';
import {UploadErrorComponent} from '../components/upload-error/upload-error.component';
import {ActivityMetadataComponent} from '../components/activity-metadata/activity-metadata.component';
import {UploadComponent} from '../components/upload/upload.component';
import {EventTableComponent} from '../components/event-table/event.table.component';


@NgModule({
  imports: [
    CommonModule,
    SharedModule,
    MaterialModule,
    DashboardRoutingModule
  ],
  exports: [
  ],
  declarations: [
    DashboardComponent,
    UploadComponent,
    UploadInfoComponent,
    ChartsPieComponent,
    ChartsXYComponent,
    ChartsTimelineComponent,
    SummariesComponent,
    ChartActionsComponent,
    EventSearchComponent,
    EventsExportFormComponent,
    EditInputComponent,
    UploadErrorComponent,
    ActivityMetadataComponent,
    EventTableComponent,
  ],
  entryComponents: [
    UploadErrorComponent,
    EventsExportFormComponent,
  ],
  providers: [
  ]
})



export class DashboardModule { }
