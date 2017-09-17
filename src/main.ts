import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';
import {Log} from 'ng2-logger';

if (environment.production) {
  enableProdMode();
  Log.setProductionMode();
}

platformBrowserDynamic().bootstrapModule(AppModule);
