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
import {EventActivitiesCardComponent} from './components/cards/event/activities/event.activities.component';
import {EventActivityTableRowComponent} from './components/cards/event/activities/event.activity.table.row.component';
import {EventCardMapComponent} from 'app/components/cards/event/map/event.card.map.component';
import {EventListComponent} from './components/list/event.list.component';
import {LocalStorageService} from './services/app.local.storage.service';
import {EventCardActionsMenuComponent} from 'app/components/cards/event/actions/event.card.actions.menu.component';
import {MomentModule} from 'angular2-moment';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {AmChartsModule} from '@amcharts/amcharts3-angular';
import {EventAmChartsCardComponent} from './components/cards/charts/event.charts.amcharts.card.component';
import {EventLapsCardComponent} from './components/cards/laps/event.laps.card.component';
import {EventLapTableRowComponent} from './components/cards/laps/event.laps.table.row.component';
import {MdButtonModule, MdCardModule, MdCommonModule, MdIconModule, MdMenuModule} from '@angular/material';
import 'hammerjs';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {EventCardStatsComponent} from './components/cards/event/stats/event.card.stats.component';

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
    EventCardComponent,
    EventCardMapComponent,
    EventCardStatsComponent,
    EventActivitiesCardComponent,
    EventActivityTableRowComponent,
    EventCardActionsMenuComponent,
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
