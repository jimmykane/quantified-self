import {enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import {AppModule} from './app/app.module';
import {environment} from './environments/environment';
import {Log} from 'ng2-logger/browser';
import {AppThemes} from 'quantified-self-lib/lib/users/user.app.settings.interface';
import 'hammerjs';

import 'firebase/analytics';

if (environment.production) {
  enableProdMode();
  Log.setProductionMode();
}

// Set the theme before app is running
if (localStorage.getItem('appTheme')) {
  localStorage.getItem('appTheme') === AppThemes.Normal ? document.body.classList.remove('dark-theme') : document.body.classList.add('dark-theme')
}


platformBrowserDynamic().bootstrapModule(AppModule);
