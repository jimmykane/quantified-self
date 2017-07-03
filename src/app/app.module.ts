import {NgModule} from '@angular/core';

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
import {LocalStorageService} from './services/app.local.storage.service';
import {EventCardActionsMenuComponent} from 'app/components/cards/event/actions/event.card.actions.menu.component';
import {MomentModule} from 'angular2-moment';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {AmChartsModule} from '@amcharts/amcharts3-angular';
import {EventCardChartComponent} from './components/cards/event/chart/event.card.chart.component';
import {EventCardLapsComponent} from './components/cards/event/laps/event.card.laps.component';
import {EventLapTableRowComponent} from './components/cards/event/laps/event.laps.table.row.component';
import {
  MdButtonModule, MdButtonToggleModule, MdCardModule, MdCommonModule, MdIconModule, MdMenuModule,
  MdSidenavModule,
  MdTabsModule, MdToolbarModule
} from '@angular/material';
import 'hammerjs';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {EventCardStatsComponent} from './components/cards/event/stats/event.card.stats.component';
import {SideNavComponent} from './components/sidenav/sidenav.component';

@NgModule({
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyCt6rJsrVVHOSmr2oPcl2bmJ3XQmktOU3E'
    }),
    MdButtonModule,
    MdButtonToggleModule,
    MdCardModule,
    MdIconModule,
    MdCommonModule,
    MdMenuModule,
    MdTabsModule,
    MdSidenavModule,
    MdToolbarModule,
    MomentModule,
    AmChartsModule
  ],
  declarations: [
    AppComponent,
    SideNavComponent,
    DashboardComponent,
    UploadComponent,
    EventCardComponent,
    EventCardMapComponent,
    EventCardStatsComponent,
    EventActivitiesCardComponent,
    EventActivityTableRowComponent,
    EventCardActionsMenuComponent,
    EventCardLapsComponent,
    EventLapTableRowComponent,
    EventCardChartComponent,
    AboutComponent
  ],
  providers: [LocalStorageService, EventService],
  bootstrap: [AppComponent]
})

export class AppModule {
}
