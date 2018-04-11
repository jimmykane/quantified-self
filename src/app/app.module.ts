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
  MatButtonModule, MatButtonToggleModule, MatCardModule, MatChipsModule, MatCommonModule, MatExpansionModule,
  MatGridListModule, MatIconModule,
  MatMenuModule, MatProgressBarModule,
  MatSidenavModule, MatTableModule,
  MatTabsModule, MatToolbarModule, MatCheckboxModule, MatSliderModule, MatSnackBarModule, MatInputModule, MatListModule
} from '@angular/material';
import 'hammerjs';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {SideNavComponent} from './components/sidenav/sidenav.component';
import {WeatherUndergroundWeatherService} from './services/weather/app.weather-underground.weather.service';
import {HttpModule} from '@angular/http';
import {Angular2FontawesomeModule} from 'angular2-fontawesome';
import {CdkTableModule} from '@angular/cdk/table';
import {EventCardListComponent} from './components/cards/event/list/event.card.list.component';
import {EventCardSmallComponent} from './components/cards/event/event.card-small.component';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {EventCardMapAGMComponent} from './components/cards/event/map/agm/event.card.map.agm.component';
import {GeoLocationInfoService} from './services/geo-location/app.geo-location-info.service';
import {EventLocalStorageService} from './services/storage/app.event.local.storage.service';
import {EventCardStatsComponent} from './components/cards/event/stats/event.card.stats.component';
import {FormsModule} from '@angular/forms';
import {ActivityIconComponent} from './components/activity-icon/activity-icon.component';
import {DisqusModule} from 'ngx-disqus';
import {ActivitiesCheckboxesComponent} from './components/acitvities-checkboxes/activities-checkboxes.component';
import {AppEventColorService} from './services/app.event.color.service';
import { UploadInfoComponent } from './components/upload-info/upload-info.component';
import {EventCardToolsComponent} from './components/cards/event/tools/event.card.tools.component';

@NgModule({
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    HttpModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyAV0ilIsl02eRaIibidoeZ2SX03a5ud-bQ'
    }),
    DisqusModule.forRoot('quantified-self-io'),
    MatExpansionModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatIconModule,
    MatCommonModule,
    MatMenuModule,
    MatTabsModule,
    MatSidenavModule,
    MatToolbarModule,
    MatGridListModule,
    MatTableModule,
    CdkTableModule,
    MatChipsModule,
    MomentModule,
    AmChartsModule,
    MatCheckboxModule,
    MatSliderModule,
    MatSnackBarModule,
    MatInputModule,
    MatListModule,
    FormsModule,
    Angular2FontawesomeModule,
    MatProgressBarModule
  ],
  declarations: [
    AppComponent,
    SideNavComponent,
    DashboardComponent,
    UploadComponent,
    ActivityIconComponent,
    ActivitiesCheckboxesComponent,
    EventCardComponent,
    EventCardListComponent,
    EventCardMapComponent,
    EventCardMapAGMComponent,
    EventCardStatsComponent,
    EventCardActionsMenuComponent,
    EventCardLapsComponent,
    EventLapTableRowComponent,
    EventCardChartComponent,
    EventCardSmallComponent,
    EventCardToolsComponent,
    AboutComponent,
    UploadInfoComponent
  ],
  providers: [
    LocalStorageService,
    EventLocalStorageService,
    EventService,
    ActionButtonService,
    WeatherUndergroundWeatherService,
    GeoLocationInfoService,
    AppEventColorService
  ],
  bootstrap: [AppComponent]
})

export class AppModule {
}
