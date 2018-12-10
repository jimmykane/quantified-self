import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';
import {Log} from 'ng2-logger/browser';


@Injectable()
export class ChartSettingsLocalStorageService extends LocalStorageService {
  protected nameSpace = 'chart.settings.service.';
  protected logger = Log.create('ChartSettingsLocalStorageService');
}
