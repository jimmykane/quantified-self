import { APP_INITIALIZER, ErrorHandler, NgModule } from '@angular/core';
import { LoggerService, GlobalErrorHandler } from './services/logger.service';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { SideNavComponent } from './components/sidenav/sidenav.component';
import { environment } from '../environments/environment';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFirestore, initializeFirestore } from '@angular/fire/firestore';
import { getApp } from '@angular/fire/app';
import { provideFunctions, getFunctions, httpsCallable } from '@angular/fire/functions';
import { providePerformance, getPerformance } from '@angular/fire/performance';
import { provideAnalytics, getAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';
import { provideRemoteConfig, getRemoteConfig } from '@angular/fire/remote-config';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { MaterialModule } from './modules/material.module';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { ServiceWorkerModule } from '@angular/service-worker';
import { UploadActivitiesComponent } from './components/upload/upload-activities/upload-activities.component';
import { AppFilesInfoSheetService } from './services/upload/app-files-info-sheet.service';
import { AppUpdateService } from './services/app.update.service';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { MaintenanceComponent } from './components/maintenance/maintenance.component';
import { GracePeriodBannerComponent } from './components/grace-period-banner/grace-period-banner.component';
import { RouteLoaderComponent } from './components/route-loader/route-loader.component';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { firstValueFrom } from 'rxjs';

// Factory function that blocks until Remote Config is initialized
export function initializeRemoteConfig(remoteConfigService: AppRemoteConfigService) {
  return () => firstValueFrom(remoteConfigService.getMaintenanceMode());
}

@NgModule({
  declarations: [
    AppComponent,
    SideNavComponent,
    UploadActivitiesComponent,
    GracePeriodBannerComponent,
    RouteLoaderComponent,
  ],
  bootstrap: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    ClipboardModule,
    MaterialModule,
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: environment.production }),
    OnboardingComponent,
    MaintenanceComponent
  ],
  providers: [
    ScreenTrackingService,
    UserTrackingService,
    {
      provide: ErrorHandler,
      useClass: GlobalErrorHandler,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeRemoteConfig,
      deps: [AppRemoteConfigService],
      multi: true
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
    // Use initializeFirestore with ignoreUndefinedProperties to handle undefined values
    // in activity/event data (e.g., TCX files may have undefined creator.manufacturer).
    // This is the official Firebase approach - undefined fields are silently skipped, not stored.
    provideFirestore(() => {
      return initializeFirestore(getApp(), {
        ignoreUndefinedProperties: true
      });
    }),
    provideStorage(() => getStorage()),
    provideFunctions(() => getFunctions(undefined, 'europe-west2')),
    providePerformance(() => getPerformance()),
    provideAnalytics(() => getAnalytics()),
    provideRemoteConfig(() => getRemoteConfig()),
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } }
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
