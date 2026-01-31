import { Injectable } from '@angular/core';
import { LocalStorageService } from './app.local.storage.service';

@Injectable({
    providedIn: 'root',
})
export class AppWhatsNewLocalStorageService extends LocalStorageService {
    protected nameSpace = 'whats-new.';
}
