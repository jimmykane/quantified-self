import { enableProdMode } from '@angular/core';
import { environment } from './environments/environment';

if (environment.production) {
    enableProdMode();
}

import { platformServer } from '@angular/platform-server';
import { AppServerModule } from './app/app.module.server';

// const bootstrap = () => platformServer().bootstrapModule(AppServerModule);
export default AppServerModule;
