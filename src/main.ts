import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { environment } from './environments/environment';
import { AppThemes } from '@sports-alliance/sports-lib/lib/users/settings/user.app.settings.interface';
import * as Sentry from '@sentry/angular';


Sentry.init({
  dsn: 'https://e6aa6074f13d49c299f8c81bf162d88c@o147925.ingest.sentry.io/1194244',
  environment: environment.production ? 'Production' : environment.beta ? 'Beta' : 'Development',
  release: environment.appVersion,
  debug: environment.production || environment.beta,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 1.0,
});

if (environment.production) {
  enableProdMode();
}

// Set the theme before app is running
if (localStorage.getItem('appTheme')) {
  localStorage.getItem('appTheme') === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme')
}

import('./app/app.module')
  .then(x => platformBrowserDynamic().bootstrapModule(x.AppModule))
  .catch(err => console.error(err));
// platformBrowserDynamic().bootstrapModule(AppModule);
