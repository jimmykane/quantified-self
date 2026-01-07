import { NgModule } from '@angular/core';
import { ServerModule } from '@angular/platform-server';

import { AppModule } from './app.module';
import { AppComponent } from './app.component';
import { APP_STORAGE } from './services/storage/app.storage.token';
import { MemoryStorage } from './services/storage/memory.storage';
import { NoopIconRegistry } from './services/storage/noop.icon.registry';
import { MatIconRegistry } from '@angular/material/icon';

@NgModule({
    imports: [
        AppModule,
        ServerModule,
    ],
    bootstrap: [AppComponent],
    providers: [
        { provide: APP_STORAGE, useClass: MemoryStorage },
        { provide: MatIconRegistry, useClass: NoopIconRegistry }
    ]
})
export class AppServerModule { }
