import {NgModule} from '@angular/core';

import {BrowserModule} from '@angular/platform-browser';
import {AppComponent} from './app.component';
import {AppRoutingModule} from './app-routing.module';
import {UploadComponent} from './components/upload/upload.component';
import {EventService} from './services/app.event.service';
import {AgmCoreModule} from '@agm/core';
import {DashboardComponent} from './components/dashboard/dashboard.component';
import {AboutComponent} from './components/about/about.component';
import {EventCardMapComponent} from 'app/components/cards/event/map/event.card.map.component';
import {LocalStorageService} from './services/storage/app.local.storage.service';
import {EventCardActionsMenuComponent} from 'app/components/cards/event/actions/event.card.actions.menu.component';
import {MomentModule} from 'angular2-moment';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {AmChartsModule} from '@amcharts/amcharts3-angular';
import {EventCardChartComponent} from './components/cards/event/chart/event.card.chart.component';
import {EventCardLapsComponent} from './components/cards/event/laps/event.card.laps.component';
import {EventLapTableRowComponent} from './components/cards/event/laps/event.laps.table.row.component';
import {
  MdButtonModule, MdButtonToggleModule, MdCardModule, MdChipsModule, MdCommonModule, MdGridListModule, MdIconModule,
  MdMenuModule,
  MdSidenavModule, MdTableModule,
  MdTabsModule, MdToolbarModule
} from '@angular/material';
import 'hammerjs';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {EventCardStatsComponent} from './components/cards/event/stats/event.card.stats.component';
import {SideNavComponent} from './components/sidenav/sidenav.component';
import {WeatherUndergroundWeatherService} from './services/weather/app.weather-underground.weather.service';
import {HttpModule} from '@angular/http';
import {EventCardMapLocationComponent} from './components/cards/event/map/location/event.card.map.location.component';
import {EventCardMapWeatherComponent} from './components/cards/event/map/weather/event.card.map.weather.component';
import {Angular2FontawesomeModule} from 'angular2-fontawesome';
import {CdkTableModule} from '@angular/cdk/table';
import {EventCardListComponent} from './components/cards/event/list/event.card.list.component';
import {EventCardSmallComponent} from './components/cards/event/event.card-small.component';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {EventCardMapActivitiesComponent} from './components/cards/event/map/activities/event.card.map.activities.component';
import {EventCardMapAGMComponent} from './components/cards/event/map/agm/event.card.map.agm.component';
import {GeoLocationInfoService} from './services/geo-location/app.geo-location-info.service';
import {EventLocalStorageService} from './services/storage/app.event.local.storage.service';
import {GeoLocationInfoLocalStorageService} from './services/storage/app.geo-location-info.local.storage.service';

@NgModule({
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    HttpModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyAV0ilIsl02eRaIibidoeZ2SX03a5ud-bQ'
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
    MdGridListModule,
    MdTableModule,
    CdkTableModule,
    MdChipsModule,
    MomentModule,
    AmChartsModule,
    Angular2FontawesomeModule,
  ],
  declarations: [
    AppComponent,
    SideNavComponent,
    DashboardComponent,
    UploadComponent,
    EventCardComponent,
    EventCardListComponent,
    EventCardMapComponent,
    EventCardMapAGMComponent,
    EventCardMapLocationComponent,
    EventCardMapActivitiesComponent,
    EventCardMapWeatherComponent,
    EventCardStatsComponent,
    EventCardActionsMenuComponent,
    EventCardLapsComponent,
    EventLapTableRowComponent,
    EventCardChartComponent,
    EventCardSmallComponent,
    AboutComponent
  ],
  providers: [
    LocalStorageService,
    EventLocalStorageService,
    GeoLocationInfoLocalStorageService,
    EventService,
    ActionButtonService,
    WeatherUndergroundWeatherService,
    GeoLocationInfoService
  ],
  bootstrap: [AppComponent]
})

export class AppModule {
}
