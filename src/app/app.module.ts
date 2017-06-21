import {NgModule} from '@angular/core';
import {NgbModule} from '@ng-bootstrap/ng-bootstrap';

import {BrowserModule} from '@angular/platform-browser';
import {AppComponent} from './app.component';
import {AppRoutingModule} from './app-routing.module';
import {UploadComponent} from './components/upload/upload.component';
import {EventService} from './services/app.event.service';
import {AgmCoreModule} from '@agm/core';
import {DashboardComponent} from './components/dashboard/dashboard.component';
import {EventComponent} from './components/event/event.component';
import {AboutComponent} from './components/about/about.component';
import {EventActivityTableComponent} from './components/event/activity/event.activity.table.component';
import {EventActivityTableRowComponent} from './components/event/activity/event.activity.table.row.component';
import {EventMapComponent} from 'app/components/event/map/event.map.component';
import {EventListComponent} from './components/event/list/event.list.component';
import {LocalStorageService} from './services/app.local.storage.service';
import {EventActionsComponent} from 'app/components/event/actions/event.actions.component';
import {MomentModule} from 'angular2-moment';
import {ChartsModule} from 'ng2-charts';
import {EventChartsChartJSComponent} from './components/event/charts/event.charts.chartjs.component';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {AmChartsModule} from '@amcharts/amcharts3-angular';
import {EventAmChartsComponent} from './components/event/charts/event.charts.amcharts.component';

@NgModule({
  imports: [
    NgbModule.forRoot(),
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyCt6rJsrVVHOSmr2oPcl2bmJ3XQmktOU3E'
    }),
    MomentModule,
    ChartsModule,
    AmChartsModule
  ],
  declarations: [
    AppComponent,
    DashboardComponent,
    UploadComponent,
    EventComponent,
    EventMapComponent,
    EventActivityTableComponent,
    EventActivityTableRowComponent,
    EventActionsComponent,
    EventListComponent,
    EventChartsChartJSComponent,
    EventAmChartsComponent,
    AboutComponent
  ],
  providers: [LocalStorageService, EventService],
  bootstrap: [AppComponent]
})

export class AppModule {
}
