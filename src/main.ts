import {enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';

import {AppModule} from './app/app.module';
import {environment} from './environments/environment';
import {Log} from 'ng2-logger';

if (environment.production) {
  enableProdMode();
  Log.setProductionMode();

}

if (localStorage.getItem('version') !== 'v0.0.3') {
  localStorage.clear();
  localStorage.setItem('version', 'v0.0.3');
}

platformBrowserDynamic().bootstrapModule(AppModule);
