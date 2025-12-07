import 'firebase/database';
import 'firebase/firestore';
import { ErrorHandler, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { SideNavComponent } from './components/sidenav/sidenav.component';
import { environment } from '../environments/environment';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { AngularFireFunctionsModule, REGION } from '@angular/fire/compat/functions';
import * as Sentry from '@sentry/angular';
import {
  AngularFirePerformanceModule,
  DATA_COLLECTION_ENABLED,
  INSTRUMENTATION_ENABLED, PerformanceMonitoringService
} from '@angular/fire/compat/performance';
import { MaterialModule } from './modules/material.module';
import {
  AngularFireAnalyticsModule,
  APP_NAME,
  APP_VERSION,
  COLLECTION_ENABLED,
  CONFIG,
  DEBUG_MODE,
  ScreenTrackingService,
  UserTrackingService
} from '@angular/fire/compat/analytics';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { ServiceWorkerModule } from '@angular/service-worker';
import { UploadActivitiesComponent } from './components/upload/upload-activities/upload-activities.component';
import { AppFilesInfoSheetService } from './services/upload/app-files-info-sheet.service';
import { AppUpdateService } from './services/app.update.service';


@NgModule({
  declarations: [
    AppComponent,
    SideNavComponent,
    UploadActivitiesComponent,
  ],
  bootstrap: [AppComponent], imports: [BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    AngularFireModule.initializeApp(environment.firebase),
    AngularFirestoreModule,
    AngularFirestoreModule.enablePersistence({ synchronizeTabs: true }),
    AngularFireFunctionsModule,
    AngularFireAuthModule,
    AngularFirePerformanceModule,
    AngularFireAnalyticsModule,
    ClipboardModule,
    MaterialModule,
    // AGM removed - incompatible with Angular 19, maps will need migration to @angular/google-maps
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: environment.production })], providers: [
      ScreenTrackingService,
      UserTrackingService,
      PerformanceMonitoringService,
      {
        provide: ErrorHandler,
        useValue: Sentry.createErrorHandler({
          showDialog: true,
        }),
      },
      { provide: REGION, useValue: 'europe-west2' },
      {
        provide: CONFIG, useValue: {
          allow_ad_personalization_signals: false,
          anonymize_ip: true
        }
      },
      { provide: DATA_COLLECTION_ENABLED, useValue: (environment.production || environment.beta) },
      { provide: INSTRUMENTATION_ENABLED, useValue: (environment.production || environment.beta) },
      { provide: COLLECTION_ENABLED, useValue: (environment.production || environment.beta) },
      { provide: APP_VERSION, useValue: environment.appVersion },
      { provide: APP_NAME, useValue: 'quantified-self.io' },
      { provide: DEBUG_MODE, useValue: (environment.localhost || environment.beta) },
      provideHttpClient(withInterceptorsFromDi()),
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
      provideFirestore(() => getFirestore()),
    ]
})

export class AppModule {
  // Services are not used, just to make sure they're instantiated
  constructor(
    private appFilesInfoSheetService: AppFilesInfoSheetService,
    private updateService: AppUpdateService
  ) {
  }
}
