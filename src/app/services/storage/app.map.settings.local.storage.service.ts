import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';
import {Log} from 'ng2-logger/browser';


@Injectable()
export class MapSettingsLocalStorageService extends LocalStorageService {
  protected nameSpace = 'map.settings.service.';
  protected logger = Log.create('MapSettingsLocalStorageService');
}
