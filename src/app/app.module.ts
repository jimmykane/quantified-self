import {NgModule} from '@angular/core';
import {NgbModule} from '@ng-bootstrap/ng-bootstrap';

import {BrowserModule} from '@angular/platform-browser';
import {AppComponent} from './app.component';
import {AppRoutingModule} from './app-routing.module';
import {UploadComponent} from './components/upload/upload.component';
import {EventService} from './services/app.event.service';
import {AgmCoreModule} from '@agm/core';
import {DashboardComponent} from './components/dashboard/dashboard.component';
import {AboutComponent} from './components/about/about.component';
import {EventActivitiesCardComponent} from './components/event/activity/event.activities.card.component';
import {EventActivityTableRowComponent} from './components/event/activity/event.activity.table.row.component';
import {EventMapCardComponent} from 'app/components/event/map/event.map.card.component';
import {EventListComponent} from './components/event/list/event.list.component';
import {LocalStorageService} from './services/app.local.storage.service';
import {EventActionsComponent} from 'app/components/event/actions/event.actions.menu.component';
import {MomentModule} from 'angular2-moment';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {AmChartsModule} from '@amcharts/amcharts3-angular';
import {EventAmChartsCardComponent} from './components/event/charts/event.charts.amcharts.card.component';
import {EventLapsCardComponent} from './components/event/laps/event.laps.card.component';
import {EventLapTableRowComponent} from './components/event/laps/event.laps.table.row.component';
import {MdButtonModule, MdCardModule, MdCommonModule, MdIconModule, MdMenuModule} from '@angular/material';
import 'hammerjs';

@NgModule({
  imports: [
    NgbModule.forRoot(),
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyCt6rJsrVVHOSmr2oPcl2bmJ3XQmktOU3E'
    }),
    MdButtonModule,
    MdCardModule,
    MdIconModule,
    MdCommonModule,
    MdMenuModule,
    MomentModule,
    AmChartsModule
  ],
  declarations: [
    AppComponent,
    DashboardComponent,
    UploadComponent,
    EventMapCardComponent,
    EventActivitiesCardComponent,
    EventActivityTableRowComponent,
    EventActionsComponent,
    EventListComponent,
    EventLapsCardComponent,
    EventLapTableRowComponent,
    EventAmChartsCardComponent,
    AboutComponent
  ],
  providers: [LocalStorageService, EventService],
  bootstrap: [AppComponent]
})

export class AppModule {
}
