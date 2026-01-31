import { ErrorHandler, LOCALE_ID, NgModule, inject, provideAppInitializer } from '@angular/core';
import { GlobalErrorHandler } from './services/global-error-handler.service';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routing.module';
import { provideAnimations } from '@angular/platform-browser/animations';
import { SideNavComponent } from './components/sidenav/sidenav.component';
import { environment } from '../environments/environment';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from '@angular/fire/firestore';
import { getApp } from '@angular/fire/app';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { provideAppCheck, initializeAppCheck, ReCaptchaV3Provider, AppCheck } from '@angular/fire/app-check';
import { providePerformance, getPerformance } from '@angular/fire/performance';
import { provideAnalytics, getAnalytics, ScreenTrackingService, UserTrackingService, setAnalyticsCollectionEnabled, initializeAnalytics } from '@angular/fire/analytics';
import { provideRemoteConfig, getRemoteConfig } from '@angular/fire/remote-config';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { MaterialModule } from './modules/material.module';
import { SharedModule } from './modules/shared.module';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { ServiceWorkerModule } from '@angular/service-worker';
import { UploadActivitiesComponent } from './components/upload/upload-activities/upload-activities.component';
import { GoogleMapsLoaderService } from './services/google-maps-loader.service';
import { LoggerService } from './services/logger.service';

import { AppUpdateService } from './services/app.update.service';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { MaintenanceComponent } from './components/maintenance/maintenance.component';
import { GracePeriodBannerComponent } from './components/grace-period-banner/grace-period-banner.component';
import { RouteLoaderComponent } from './components/route-loader/route-loader.component';
import { ProcessingIndicatorComponent } from './components/notifications/processing-indicator/processing-indicator.component';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { firstValueFrom } from 'rxjs';

import { MAT_DATE_LOCALE_PROVIDER, getBrowserLocale } from './shared/adapters/date-locale.config';
import { APP_STORAGE } from './services/storage/app.storage.token';


@NgModule({
  declarations: [
    AppComponent,
    SideNavComponent,
    UploadActivitiesComponent,
    ProcessingIndicatorComponent,
    GracePeriodBannerComponent,
    RouteLoaderComponent,
  ],
  bootstrap: [AppComponent],
  imports: [
    BrowserModule,
    SharedModule,
    AppRoutingModule,
    ClipboardModule,
    MaterialModule,
    ServiceWorkerModule.register('ngsw-worker.js', { enabled: environment.production || environment.beta }),
    OnboardingComponent,
    MaintenanceComponent
  ],
  providers: [
    provideAnimations(),
    ScreenTrackingService,
    UserTrackingService,
    {
      provide: ErrorHandler,
      useClass: GlobalErrorHandler,
    },
    provideHttpClient(withInterceptorsFromDi()),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAppCheck(() => {
      const provider = new ReCaptchaV3Provider(environment.firebase.recaptchaSiteKey);
      if (!environment.production && !environment.beta) {
        (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      } else {
        (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = false;
      }
      return initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
    }),
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
        ignoreUndefinedProperties: true,
        // @ts-ignore
        useFetchStreams: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
          cacheSizeBytes: 104857600 // 100 MB
        }),

      });
    }),
    provideStorage(() => getStorage()),
    provideFunctions(() => {
      const functions = getFunctions(undefined, 'europe-west2');
      if (environment.localhost) {
        // connectFunctionsEmulator(functions, 'localhost', 5001); // Temp disable for now
      }
      return functions;
    }),
    providePerformance(() => getPerformance()),
    provideAnalytics(() => initializeAnalytics(getApp(), {
      config: {
        app_name: environment.firebase.projectId,
        app_version: environment.appVersion,
        debug_mode: environment.localhost
      }
    })),
    provideRemoteConfig(() => getRemoteConfig()),
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { panelClass: 'qs-dialog-container', hasBackdrop: true } },
    MAT_DATE_LOCALE_PROVIDER,
    { provide: LOCALE_ID, useFactory: getBrowserLocale },
    {
      provide: APP_STORAGE,
      useFactory: () => localStorage
    },
    provideAppInitializer(() => {
      const remoteConfigService = inject(AppRemoteConfigService);
      // Just inject to ensure initialization
      inject(GoogleMapsLoaderService);
      inject(AppUpdateService); // Check if we can move this from constructor
    }),
  ]
})
export class AppModule {
  // Services are not used, just to make sure they're instantiated
  constructor(
    private updateService: AppUpdateService
  ) {
  }
}
