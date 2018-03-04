import {enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import {AppModule} from './app/app.module';
import {environment} from './environments/environment';
import {Log} from 'ng2-logger';

declare function require(moduleName: string): any;
const { version: appVersion } = require('../package.json');

if (environment.production) {
  enableProdMode();
  Log.setProductionMode();
}

if (appVersion !== localStorage.getItem('version')) {
  localStorage.clear();
  localStorage.setItem('version', appVersion);
}

platformBrowserDynamic().bootstrapModule(AppModule);
