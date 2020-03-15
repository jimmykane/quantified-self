import 'firebase/database';
import 'firebase/firestore';
import {ErrorHandler, Injectable, NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {AppComponent} from './app.component';
import {AppRoutingModule} from './app-routing.module';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {SideNavComponent} from './components/sidenav/sidenav.component';
import {environment} from '../environments/environment';
import {HttpClientModule} from '@angular/common/http';
import {AngularFireModule} from '@angular/fire';
import {AngularFirestoreModule} from '@angular/fire/firestore';
import {AngularFireAuthModule} from '@angular/fire/auth';
import { AngularFireFunctionsModule, REGION } from '@angular/fire/functions';
import * as Sentry from '@sentry/browser';
import {
  AngularFirePerformanceModule,
  AUTOMATICALLY_TRACE_CORE_NG_METRICS, DATA_COLLECTION_ENABLED,
  INSTRUMENTATION_ENABLED
} from '@angular/fire/performance';
import {MaterialModule} from './modules/material.module';
import {AppAuthService} from './authentication/app.auth.service';
import {AppAuthGuard} from './authentication/app.auth.guard';
import {AppChartSettingsLocalStorageService} from './services/storage/app.chart.settings.local.storage.service';
import {AppEventService} from './services/app.event.service';
import {AppActionButtonService} from './services/action-buttons/app.action-button.service';
import {AppEventColorService} from './services/color/app.event.color.service';
import {AppSharingService} from './services/app.sharing.service';
import {AppFileService} from './services/app.file.service';
import {AppUserService} from './services/app.user.service';
import {AppSideNavService} from './services/side-nav/app-side-nav.service';
import {AppThemeService} from './services/app.theme.service';
import {AppInfoService} from './services/app.info.service';
import {AppWindowService} from './services/app.window.service';
import {AgmCoreModule} from '@agm/core';
import {
  AngularFireAnalyticsModule,
  APP_NAME,
  APP_VERSION, COLLECTION_ENABLED, CONFIG,
  DEBUG_MODE, ScreenTrackingService, UserTrackingService
} from '@angular/fire/analytics';
import {AppActivitySelectionService} from './services/activity-selection-service/app-activity-selection.service';
import {AppActivityCursorService} from './services/activity-cursor/app-activity-cursor.service';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { ServiceWorkerModule } from '@angular/service-worker';

declare function require(moduleName: string): any;

const appPackage = require('../../package.json');

Sentry.init({
  dsn: 'https://e6aa6074f13d49c299f8c81bf162d88c@sentry.io/1194244',
  environment: environment.production ? 'Production' : environment.beta ? 'Beta' : 'Development',
  release: appPackage.version,
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
    AngularFirestoreModule.enablePersistence({synchronizeTabs: false}),
    AngularFireFunctionsModule,
    AngularFireAuthModule,
    AngularFirePerformanceModule,
    AngularFireAnalyticsModule,
    ClipboardModule,
    MaterialModule,
    AgmCoreModule.forRoot({
      apiKey: 'AIzaSyBdR4jbTKmm_P4L7t26IFAgFn6Eoo02aU0',
      apiVersion: 'weekly',
      libraries: ['visualization']
    }),
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: environment.production })
  ],
  declarations: [
    AppComponent,
    SideNavComponent,
  ],
  entryComponents: [],
  providers: [
    ScreenTrackingService,
    UserTrackingService,
    {provide: ErrorHandler, useClass: (environment.production ||  environment.beta) ? SentryErrorHandler : ErrorHandler},
    {provide: REGION, useValue: 'europe-west2'},
    {provide: CONFIG, useValue: {
        allow_ad_personalization_signals: false,
        anonymize_ip: true
      }},
    {provide: AUTOMATICALLY_TRACE_CORE_NG_METRICS, useValue: (environment.production ||  environment.beta)},
    {provide: DATA_COLLECTION_ENABLED, useValue: (environment.production ||  environment.beta)},
    {provide: INSTRUMENTATION_ENABLED, useValue: (environment.production ||  environment.beta)},
    {provide: COLLECTION_ENABLED, useValue: (environment.production ||  environment.beta)},
    {provide: APP_VERSION, useValue: appPackage.version},
    {provide: APP_NAME, useValue: 'quantified-self.io'},
    {provide: DEBUG_MODE, useValue: (environment.localhost || environment.beta)},
  ],
  bootstrap: [AppComponent],
})

export class AppModule {
}
