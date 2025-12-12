import { ErrorHandler, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { SideNavComponent } from './components/sidenav/sidenav.component';
import { environment } from '../environments/environment';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { providePerformance, getPerformance } from '@angular/fire/performance';
import { provideAnalytics, getAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';
import { provideStorage, getStorage } from '@angular/fire/storage';
import * as Sentry from '@sentry/angular';
import { MaterialModule } from './modules/material.module';
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
  bootstrap: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    ClipboardModule,
    MaterialModule,
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: environment.production })
  ],
  providers: [
    ScreenTrackingService,
    UserTrackingService,
    {
      provide: ErrorHandler,
      useValue: Sentry.createErrorHandler({
        showDialog: false,
      }),
    },
    provideHttpClient(withInterceptorsFromDi()),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      if (environment.useAuthEmulator) {
        connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      }
      return auth;
    }),
    provideFirestore(() => {
      const firestore = getFirestore();
      return firestore;
    }),
    provideStorage(() => getStorage()),
    provideFunctions(() => getFunctions(undefined, 'europe-west2')),
    providePerformance(() => getPerformance()),
    provideAnalytics(() => getAnalytics()),
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
