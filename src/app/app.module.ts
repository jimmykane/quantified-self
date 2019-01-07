import {ErrorHandler, NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {AppComponent} from './app.component';
import {AppRoutingModule} from './app-routing.module';
import {UploadComponent} from './components/upload/upload.component';
import {EventService} from './services/app.event.service';
import {AgmCoreModule} from '@agm/core';
import {DashboardComponent} from './components/dashboard/dashboard.component';
import {HomeComponent} from './components/home/home.component';
import {EventActionsComponent} from 'app/components/event-actions/event.actions.component';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {EventCardLapsComponent} from './components/cards/event/laps/event.card.laps.component';
import {
  MatButtonModule,
  MatButtonToggleModule,
  MatCardModule,
  MatChipsModule,
  MatCommonModule,
  MatExpansionModule,
  MatGridListModule,
  MatIconModule,
  MatMenuModule,
  MatProgressBarModule,
  MatSidenavModule,
  MatTableModule,
  MatTabsModule,
  MatToolbarModule,
  MatCheckboxModule,
  MatSliderModule,
  MatSnackBarModule,
  MatInputModule,
  MatListModule,
  MatSortModule,
  MatTooltipModule,
  MatDialogModule,
  MatSlideToggleModule,
  MatDatepickerModule,
  MatNativeDateModule,
  MatRadioModule, MatPaginatorModule, MatProgressSpinnerModule,
} from '@angular/material';
import 'hammerjs';
import {EventCardComponent} from './components/cards/event/event.card.component';
import {SideNavComponent} from './components/sidenav/sidenav.component';
import {Angular2FontawesomeModule} from 'angular2-fontawesome';
import {CdkTableModule} from '@angular/cdk/table';
import {EventTableComponent} from './components/event-table/event.table.component';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {EventCardMapAGMComponent} from './components/cards/event/map/agm/event.card.map.agm.component';
import {EventCardStatsComponent} from './components/cards/event/stats/event.card.stats.component';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {ActivityIconComponent} from './components/activity-icon/activity-icon.component';
import {ActivitiesCheckboxesComponent} from './components/acitvities-checkboxes/activities-checkboxes.component';
import {EventColorService} from './services/color/app.event.color.service';
import {UploadInfoComponent} from './components/upload-info/upload-info.component';
import {EventCardToolsComponent} from './components/cards/event/tools/event.card.tools.component';
import {ActivityHeaderComponent} from './components/activity-header/activity-header.component';
import * as Raven from 'raven-js';
import {environment} from '../environments/environment';
import {HttpClientModule} from '@angular/common/http';
import {EventFormComponent} from './components/event-form/event.form.component';
import {ActivityActionsComponent} from './components/activity-actions/activity.actions.component';
import {MapActionsComponent} from './components/map-actions/map.actions.component';
import {MapSettingsLocalStorageService} from './services/storage/app.map.settings.local.storage.service';
import {EventCardChartNewComponent} from './components/cards/event/chart/event.card.chart.component';
import {UploadErrorComponent} from './components/upload-error/upload-error.component';
import {ActivityMetadataComponent} from './components/activity-metadata/activity-metadata.component';
import {ActivityFormComponent} from './components/activity-form/activity.form.component';
import {ChartActionsComponent} from './components/chart-actions/chart.actions.component';
import {ChartSettingsLocalStorageService} from './services/storage/app.chart.settings.local.storage.service';
import {UserSettingsService} from './services/app.user.settings.service';
import {AngularFireModule} from '@angular/fire';
import {AngularFirestoreModule} from '@angular/fire/firestore';
import {AngularFireAuthModule} from '@angular/fire/auth';
import {AngularFireStorageModule} from '@angular/fire/storage';
import {AppAuthService} from './authentication/app.auth.service';
import {AppAuthGuard} from './authentication/app.auth.guard';
import {LoginComponent} from './components/login/login.component';
import {PrivacyIconComponent} from './components/privacy-icon/privacy-icon.component';
import {ClipboardService} from './services/app.clipboard.service';
import {SharingService} from './services/app.sharing.service';
import {FileService} from './services/app.file.service';
import {UserComponent} from './components/user/user.component';
import {UserService} from './services/app.user.service';
import {UserActionsComponent} from './components/user-actions/user.actions.component';
import {UserFormComponent} from './components/user-forms/user.form.component';
import {UserAgreementFormComponent} from './components/user-forms/user-agreement.form.component';
import {ShadeComponent} from "./components/loading/shade.component";

Raven
  .config('https://e6aa6074f13d49c299f8c81bf162d88c@sentry.io/1194244', {
    environment: environment.production ? 'Production' : 'Development',
    shouldSendCallback: function () {
      return environment.production;
    },
  })
  .install();

export class RavenErrorHandler implements ErrorHandler {
  handleError(err: any): void {
    Raven.captureException(err);
  }
}

@NgModule({
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    HttpClientModule,
    AngularFireModule.initializeApp(environment.firebase),
    AngularFirestoreModule,
    AngularFirestoreModule.enablePersistence(),
    AngularFireStorageModule,
    AngularFireAuthModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
      // apiVersion: '3.31'
    }),
    ReactiveFormsModule,
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
    MatCheckboxModule,
    MatSliderModule,
    MatSnackBarModule,
    MatInputModule,
    MatListModule,
    FormsModule,
    Angular2FontawesomeModule,
    MatProgressBarModule,
    MatTableModule,
    MatSortModule,
    MatTooltipModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatRadioModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
  ],
  declarations: [
    AppComponent,
    SideNavComponent,
    DashboardComponent,
    UploadComponent,
    ActivityIconComponent,
    PrivacyIconComponent,
    ActivitiesCheckboxesComponent,
    EventCardComponent,
    EventActionsComponent,
    EventTableComponent,
    EventCardMapAGMComponent,
    EventCardStatsComponent,
    EventActionsComponent,
    EventCardLapsComponent,
    EventCardToolsComponent,
    HomeComponent,
    LoginComponent,
    UploadInfoComponent,
    ActivityHeaderComponent,
    EventFormComponent,
    ActivityFormComponent,
    ActivityActionsComponent,
    MapActionsComponent,
    EventCardChartNewComponent,
    UploadErrorComponent,
    ActivityMetadataComponent,
    ChartActionsComponent,
    UserComponent,
    UserActionsComponent,
    UserFormComponent,
    UserAgreementFormComponent,
    ShadeComponent,
  ],
  entryComponents: [
    EventFormComponent,
    UserFormComponent,
    UserAgreementFormComponent,
    ActivityFormComponent,
    UploadErrorComponent,
  ],
  providers: [
    AppAuthService,
    AppAuthGuard,
    MapSettingsLocalStorageService,
    ChartSettingsLocalStorageService,
    UserSettingsService,
    EventService,
    ActionButtonService,
    EventColorService,
    ClipboardService,
    SharingService,
    FileService,
    UserService,
    // {provide: ErrorHandler, useClass: RavenErrorHandler}
    {provide: ErrorHandler, useClass: environment.production ? RavenErrorHandler : ErrorHandler},
  ],
  bootstrap: [AppComponent],
})

export class AppModule {
}
