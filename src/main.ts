// Buffer (dependency of FIT parser) uses global to check against typed arrays
(window as any).global = window;

import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { environment } from './environments/environment';
import { AppThemes } from '@sports-alliance/sports-lib';
import * as Sentry from '@sentry/angular';
import { registerAppLocales } from './app/shared/adapters/date-locale.config';
import { SYSTEM_THEME_PREFERENCE } from './app/models/app-theme-preference.type';

// Register locales immediately
registerAppLocales();

redirectFromFirebaseHostingAlias();


// Only initialize Sentry in non-localhost environments
if (!environment.localhost) {
  Sentry.init({
    dsn: 'https://e6aa6074f13d49c299f8c81bf162d88c@o147925.ingest.sentry.io/1194244',
    environment: environment.production ? 'Production' : environment.beta ? 'Beta' : 'Development',
    release: environment.appVersion,
    debug: false,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    // ResizeObserver loop limit exceeded is a benign warning in browsers
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Network Error',
      'Non-Error promise rejection captured'
    ],

    // We recommend adjusting this value in production, or using tracesSampler
    // for finer control
    tracesSampleRate: 0.2,
  });
}

if (environment.production) {
  enableProdMode();
}

// Set the theme before app is running
const storedThemePreference = localStorage.getItem('appTheme');
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const followsSystem = !storedThemePreference || storedThemePreference === SYSTEM_THEME_PREFERENCE;
const shouldUseDarkTheme = storedThemePreference === AppThemes.Dark || (followsSystem && systemPrefersDark);
document.body.classList.toggle('dark-theme', shouldUseDarkTheme);

import('./app/app.module')
  .then(x => platformBrowserDynamic().bootstrapModule(x.AppModule))
  .catch(err => console.error(err));
// platformBrowserDynamic().bootstrapModule(AppModule);

function redirectFromFirebaseHostingAlias(): void {
  if (environment.localhost) {
    return;
  }

  const currentHost = window.location.hostname.toLowerCase();
  if (!currentHost.endsWith('.firebaseapp.com')) {
    return;
  }

  if (window.location.pathname.startsWith('/__/auth/')) {
    return;
  }

  let targetOrigin: string;
  try {
    targetOrigin = new URL(environment.appUrl).origin;
  } catch {
    return;
  }

  if (!targetOrigin || targetOrigin === window.location.origin) {
    return;
  }

  const redirectUrl = `${targetOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(redirectUrl);
}
