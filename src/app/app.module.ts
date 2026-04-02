import { ErrorHandler, LOCALE_ID, NgModule, inject, provideAppInitializer } from '@angular/core';
import { GlobalErrorHandler } from './services/global-error-handler.service';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { AppShellComponent } from './app-shell.component';
import { AppRoutingModule } from './app.routing.module';
import { provideAnimations } from '@angular/platform-browser/animations';
import { SideNavComponent } from './components/sidenav/sidenav.component';
import { environment } from '../environments/environment';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideFirebaseApp, initializeApp } from 'app/firebase/app';
import { provideAuth, getAuth } from 'app/firebase/auth';
import { provideFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'app/firebase/firestore';
import { getApp } from 'app/firebase/app';
import { provideFunctions, getFunctions } from 'app/firebase/functions';
import { provideAppCheck, initializeAppCheck, ReCaptchaV3Provider } from 'app/firebase/app-check';
import { providePerformance, getPerformance } from 'app/firebase/performance';
import { provideAnalytics, initializeAnalytics } from 'app/firebase/analytics';
import { provideRemoteConfig, getRemoteConfig } from 'app/firebase/remote-config';
import { provideStorage, getStorage } from 'app/firebase/storage';
import { MaterialModule } from './modules/material.module';
import { SharedModule } from './modules/shared.module';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { FullscreenOverlayContainer, OverlayContainer } from '@angular/cdk/overlay';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_BOTTOM_SHEET_DEFAULT_OPTIONS } from '@angular/material/bottom-sheet';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { MAT_MENU_DEFAULT_OPTIONS, MatMenuDefaultOptions } from '@angular/material/menu';
import { ServiceWorkerModule } from '@angular/service-worker';
import { UploadActivitiesComponent } from './components/upload/upload-activities/upload-activities.component';
import { maybeConnectAuthEmulator } from './authentication/auth-emulator.config';

import { AppUpdateService } from './services/app.update.service';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { MaintenanceComponent } from './components/maintenance/maintenance.component';
import { GracePeriodBannerComponent } from './components/grace-period-banner/grace-period-banner.component';
import { RouteLoaderComponent } from './components/route-loader/route-loader.component';
import { ProcessingIndicatorComponent } from './components/notifications/processing-indicator/processing-indicator.component';
import { ImpersonationBannerComponent } from './components/impersonation-banner/impersonation-banner.component';
import { MetricLoaderComponent } from './components/metric-loader/metric-loader.component';
import { AppShellHeaderComponent } from './components/app-shell-header/app-shell-header.component';
import { AppRemoteConfigService } from './services/app.remote-config.service';
import { FirebaseAnalyticsTrackingService } from './services/firebase-analytics-tracking.service';

import { MAT_DATE_LOCALE_PROVIDER, getBrowserLocale } from './shared/adapters/date-locale.config';
import { APP_STORAGE } from './services/storage/app.storage.token';

export const QS_MENU_DEFAULT_OPTIONS: MatMenuDefaultOptions = {
  overlayPanelClass: 'qs-menu-panel',
  hasBackdrop: true,
  overlapTrigger: false,
  xPosition: 'after',
  yPosition: 'below',
  backdropClass: 'cdk-overlay-transparent-backdrop'
};

const enableAppCheck = environment.production || environment.beta || environment.localhost;
// `useFetchStreams` is an internal/unsupported Firestore Web SDK option.
// We scope it behind this local type instead of `@ts-ignore` so usage is explicit and searchable.
// If Firebase drops or changes this flag in a future release, remove it and re-validate Firestore-heavy flows.
type FirestoreInitSettings = Parameters<typeof initializeFirestore>[1] & {
  useFetchStreams?: boolean;
};

@NgModule({
  declarations: [
    AppComponent,
    AppShellComponent,
    SideNavComponent,
    UploadActivitiesComponent,
    ProcessingIndicatorComponent,
    GracePeriodBannerComponent,
    RouteLoaderComponent,
    MetricLoaderComponent,
    AppShellHeaderComponent,
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
    MaintenanceComponent,
    ImpersonationBannerComponent
  ],
  providers: [
    provideAnimations(),
    {
      provide: ErrorHandler,
      useClass: GlobalErrorHandler,
    },
    provideHttpClient(withInterceptorsFromDi()),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    ...(enableAppCheck ? [provideAppCheck(() => {
      const provider = new ReCaptchaV3Provider(environment.firebase.recaptchaSiteKey);
      (window as any).FIREBASE_APPCHECK_DEBUG_TOKEN = !environment.production && !environment.beta;
      return initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
    })] : []),
    provideAuth(() => {
      const auth = getAuth();
      return maybeConnectAuthEmulator(auth);
    }),
    // Use initializeFirestore with ignoreUndefinedProperties to handle undefined values
    // in activity/event data (e.g., TCX files may have undefined creator.manufacturer).
    // This is the official Firebase approach - undefined fields are silently skipped, not stored.
    provideFirestore(() => {
      const firestoreSettings: FirestoreInitSettings = {
        ignoreUndefinedProperties: true,
        // Internal flag: keep as best-effort optimization, not as a contract we rely on.
        useFetchStreams: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
          cacheSizeBytes: 1073741824 // 1 GB
        }),
      };
      return initializeFirestore(getApp(), firestoreSettings);
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
    { provide: OverlayContainer, useClass: FullscreenOverlayContainer },
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    { provide: MAT_ICON_DEFAULT_OPTIONS, useValue: { fontSet: 'material-symbols-rounded' } },
    { provide: MAT_MENU_DEFAULT_OPTIONS, useValue: QS_MENU_DEFAULT_OPTIONS },
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { panelClass: 'qs-dialog-container', hasBackdrop: true } },
    { provide: MAT_BOTTOM_SHEET_DEFAULT_OPTIONS, useValue: { autoFocus: 'dialog', panelClass: 'qs-bottom-sheet-container' } },
    MAT_DATE_LOCALE_PROVIDER,
    { provide: LOCALE_ID, useFactory: getBrowserLocale },
    {
      provide: APP_STORAGE,
      useFactory: () => localStorage
    },
    provideAppInitializer(() => {
      // Just inject to ensure initialization
      inject(AppRemoteConfigService);
      inject(AppUpdateService); // Check if we can move this from constructor
      inject(FirebaseAnalyticsTrackingService);
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
