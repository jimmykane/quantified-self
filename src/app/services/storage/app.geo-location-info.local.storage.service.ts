import {Injectable} from '@angular/core';
import {LocalStorageService} from './app.local.storage.service';


@Injectable()
export class GeoLocationInfoLocalStorageService extends LocalStorageService {
  protected nameSpace = 'geoLocationInfo';
}
