import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';


@Injectable()
export class EventLocalStorageService extends LocalStorageService {
  protected nameSpace = 'event.service';
}
