import {enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import {environment} from './environments/environment';
import {Log} from 'ng2-logger/browser';
import {AppThemes} from '@sports-alliance/sports-lib/lib/users/settings/user.app.settings.interface';

import 'firebase/analytics';

if (environment.production) {
  enableProdMode();
  Log.setProductionMode();
}

// Set the theme before app is running
if (localStorage.getItem('appTheme')) {
  localStorage.getItem('appTheme') === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme')
}

import('./app/app.module')
  .then(x => platformBrowserDynamic().bootstrapModule(x.AppModule))
  .catch(err => console.error(err));
// platformBrowserDynamic().bootstrapModule(AppModule);
