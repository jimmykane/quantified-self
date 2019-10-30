import {ErrorHandler, Injectable, NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {AppComponent} from './app.component';
import {AppRoutingModule} from './app-routing.module';
import {UploadComponent} from './components/upload/upload.component';
import {AgmCoreModule} from '@agm/core';
import {DashboardComponent} from './components/dashboard/dashboard.component';
import {HomeComponent} from './components/home/home.component';
import {EventActionsComponent} from 'app/components/event-actions/event.actions.component';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {EventCardLapsComponent} from './components/cards/event/laps/event.card.laps.component';
import {MatPaginatorModule, MatPaginatorIntl} from '@angular/material/paginator';
import 'hammerjs';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {SideNavComponent} from './components/sidenav/sidenav.component';
import {EventTableComponent, MatPaginatorIntlFireStore} from './components/event-table/event.table.component';
import {EventCardStatsComponent} from './components/cards/event/stats/event.card.stats.component';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {ActivityIconComponent} from './components/activity-icon/activity-icon.component';
import {ActivitiesCheckboxesComponent} from './components/acitvities-checkboxes/activities-checkboxes.component';
import {UploadInfoComponent} from './components/upload-info/upload-info.component';
import {EventCardToolsComponent} from './components/cards/event/tools/event.card.tools.component';
import {ActivityHeaderComponent} from './components/activity-header/activity-header.component';
import {environment} from '../environments/environment';
import {HttpClientModule} from '@angular/common/http';
import {EventFormComponent} from './components/event-form/event.form.component';
import {ActivityActionsComponent} from './components/activity-actions/activity.actions.component';
import {MapActionsComponent} from './components/map-actions/map.actions.component';
import {MapSettingsLocalStorageService} from './services/storage/app.map.settings.local.storage.service';
import {EventCardChartComponent} from './components/cards/event/chart/event.card.chart.component';
import {UploadErrorComponent} from './components/upload-error/upload-error.component';
import {ActivityMetadataComponent} from './components/activity-metadata/activity-metadata.component';
import {ActivityFormComponent} from './components/activity-form/activity.form.component';
import {AngularFireModule} from '@angular/fire';
import {AngularFirestoreModule} from '@angular/fire/firestore';
import {AngularFireAuthModule} from '@angular/fire/auth';
import {AngularFireStorageModule} from '@angular/fire/storage';
import {EventSearchComponent} from './components/event-search/event-search.component';
import {EventCardDevicesComponent} from './components/cards/event/devices/event.card.devices.component';
import {AngularFireFunctionsModule, FunctionsRegionToken} from '@angular/fire/functions';
import {HistoryImportFormComponent} from './components/history-import-form/history-import.form.component';
import {ChartsPieComponent} from './components/charts/pie/charts.pie.component';
import {SummariesComponent} from './components/summaries/summaries.component';
import * as Sentry from '@sentry/browser';
import {ChartActionsComponent} from './components/charts/actions/chart.actions.component';
import {EventCardChartActionsComponent} from './components/cards/event/chart/actions/event.card.chart.actions.component';
import {EventCardMapComponent} from './components/cards/event/map/event.card.map.component';
import {EditInputComponent} from './components/edit-input/edit-input.component';
import {EventsExportFormComponent} from './components/events-export-form/events-export.form.component';
import {AngularFirePerformanceModule} from '@angular/fire/performance';
import {ChartsTimelineComponent} from './components/charts/timeline/charts.timeline.component';
import {ChartsXYComponent} from './components/charts/xy/charts.xy.component';
import {MaterialModule} from './modules/material.module';
import {SharedModule} from './modules/shared.module';

declare function require(moduleName: string): any;

const {version: appVersion} = require('../../package.json');

Sentry.init({
  dsn: 'https://e6aa6074f13d49c299f8c81bf162d88c@sentry.io/1194244',
  environment: environment.production ? 'Production' : 'Development',
  release: appVersion,
});


@Injectable()
export class SentryErrorHandler implements ErrorHandler {
  constructor() {
  }

  handleError(error) {
    // Sentry.showReportDialog({ eventId });
    // const eventId = Sentry.captureException(error.originalError || error);
    console.log(error);
    Sentry.captureException(error)
  }
}


@NgModule({
  imports: [
    SharedModule,
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    HttpClientModule,
    AngularFireModule.initializeApp(environment.firebase),
    AngularFirestoreModule,
    AngularFirestoreModule.enablePersistence({synchronizeTabs: true}),
    AngularFireFunctionsModule,
    AngularFireStorageModule,
    AngularFireAuthModule,
    AngularFirePerformanceModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
      apiVersion: 'weekly'
    }),
    MaterialModule,
  ],
  declarations: [
    AppComponent,
    SideNavComponent,
    DashboardComponent,
    UploadComponent,
    ActivityIconComponent,
    ActivitiesCheckboxesComponent,
    EventCardComponent,
    EventActionsComponent,
    EventTableComponent,
    EventCardMapComponent,
    EventCardStatsComponent,
    EventActionsComponent,
    EventCardLapsComponent,
    EventCardToolsComponent,
    HomeComponent,
    UploadInfoComponent,
    ActivityHeaderComponent,
    EventFormComponent,
    ActivityFormComponent,
    ActivityActionsComponent,
    MapActionsComponent,
    EventCardChartComponent,
    UploadErrorComponent,
    ActivityMetadataComponent,
    EventCardChartActionsComponent,
    EventSearchComponent,
    EventCardDevicesComponent,
    ChartsPieComponent,
    ChartsXYComponent,
    SummariesComponent,
    ChartActionsComponent,
    EditInputComponent,
    EventsExportFormComponent,
    ChartsTimelineComponent
  ],
  entryComponents: [
    EventFormComponent,
    ActivityFormComponent,
    UploadErrorComponent,
    EventsExportFormComponent
  ],
  providers: [
    // {provide: ErrorHandler, useClass: SentryErrorHandler}
    {provide: ErrorHandler, useClass: environment.production ? SentryErrorHandler : ErrorHandler},
    {provide: MatPaginatorIntl, useClass: MatPaginatorIntlFireStore},
    {provide: FunctionsRegionToken, useValue: 'europe-west2'}
  ],
  bootstrap: [AppComponent],
})

export class AppModule {
}
