import {ErrorHandler, Injectable, NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {AppComponent} from './app.component';
import {AppRoutingModule} from './app-routing.module';
import {HomeComponent} from './components/home/home.component';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {SideNavComponent} from './components/sidenav/sidenav.component';
import {environment} from '../environments/environment';
import {HttpClientModule} from '@angular/common/http';
import {EventFormComponent} from './components/event-form/event.form.component';
import {ActivityFormComponent} from './components/activity-form/activity.form.component';
import {AngularFireModule} from '@angular/fire';
import {AngularFirestoreModule} from '@angular/fire/firestore';
import {AngularFireAuthModule} from '@angular/fire/auth';
import {AngularFireStorageModule} from '@angular/fire/storage';
import {AngularFireFunctionsModule, FunctionsRegionToken} from '@angular/fire/functions';
import * as Sentry from '@sentry/browser';
import {AngularFirePerformanceModule} from '@angular/fire/performance';
import {MaterialModule} from './modules/material.module';
import {SharedModule} from './modules/shared.module';
import {AppAuthService} from './authentication/app.auth.service';
import {AppAuthGuard} from './authentication/app.auth.guard';
import {MapSettingsLocalStorageService} from './services/storage/app.map.settings.local.storage.service';
import {ChartSettingsLocalStorageService} from './services/storage/app.chart.settings.local.storage.service';
import {UserSettingsService} from './services/app.user.settings.service';
import {EventService} from './services/app.event.service';
import {ActionButtonService} from './services/action-buttons/app.action-button.service';
import {EventColorService} from './services/color/app.event.color.service';
import {ClipboardService} from './services/app.clipboard.service';
import {SharingService} from './services/app.sharing.service';
import {FileService} from './services/app.file.service';
import {UserService} from './services/app.user.service';
import {SideNavService} from './services/side-nav/side-nav.service';
import {ThemeService} from './services/app.theme.service';
import {AppInfoService} from './services/app.info.service';
import {WindowService} from './services/app.window.service';
import {DeleteConfirmationComponent} from './components/delete-confirmation/delete-confirmation.component';
import {AgmCoreModule} from '@agm/core';

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
    MaterialModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
      apiVersion: 'weekly'
    })
  ],
  declarations: [
    AppComponent,
    SideNavComponent,
    HomeComponent,
  ],
  entryComponents: [
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
    SideNavService,
    ThemeService,
    AppInfoService,
    WindowService,
    // {provide: ErrorHandler, useClass: SentryErrorHandler}
    {provide: ErrorHandler, useClass: environment.production ? SentryErrorHandler : ErrorHandler},
    {provide: FunctionsRegionToken, useValue: 'europe-west2'}
  ],
  bootstrap: [AppComponent],
})

export class AppModule {
}
