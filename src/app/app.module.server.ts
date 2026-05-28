import { NgModule } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { MatIconRegistry } from '@angular/material/icon';
import { AppComponent } from './app.component';
import { AppModule } from './app.module';
import { serverRoutes } from './app.routes.server';
import { APP_STORAGE } from './services/storage/app.storage.token';
import { MemoryStorage } from './services/storage/memory.storage';
import { NoopIconRegistry } from './services/storage/noop.icon.registry';
import { SERVER_APP_PROVIDERS } from './app.server.providers';

@NgModule({
  imports: [AppModule],
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: APP_STORAGE, useClass: MemoryStorage },
    { provide: MatIconRegistry, useClass: NoopIconRegistry },
    ...SERVER_APP_PROVIDERS,
  ],
  bootstrap: [AppComponent],
})
export class AppServerModule { }
