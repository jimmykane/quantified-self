import {Injectable} from '@angular/core';
import {StorageServiceInterface} from '../app.storage.service.interface';
import * as LZString from 'lz-string';
import {Log} from 'ng2-logger';
import {LocalStorageService} from "./app.local.storage.service";


@Injectable()
export class GeoLocationInfoLocalStorageService extends LocalStorageService {
  protected nameSpace = 'geoLocationInfo';
}
