import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';
import {Log} from 'ng2-logger/browser';


@Injectable()
export class EventLocalStorageService extends LocalStorageService {
  protected nameSpace = 'event.service.';
  protected logger = Log.create('EventLocalStorageService');

}
