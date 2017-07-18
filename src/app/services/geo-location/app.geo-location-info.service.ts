import {Injectable} from '@angular/core';
import {DataPositionInterface} from '../../entities/data/data.position.interface';
import {MapsAPILoader} from '@agm/core';
import {GeoLocationInfo} from './app.geo-location-info';
import {GeoLocationInfoLocalStorageService} from '../storage/app.geoLocationInfo.local.storage.service';

declare const google: any;

@Injectable()
export class GeoLocationInfoService {

  private geoLocationsInfo: Map<string, GeoLocationInfo> = new Map<string, GeoLocationInfo>();

  constructor(private geoLocationInfoLocalStorageService: GeoLocationInfoLocalStorageService, private mapsAPILoader: MapsAPILoader) {
  }

  public getGeoLocationInfo(position: DataPositionInterface): Promise<GeoLocationInfo> {
    return new Promise((resolve, reject) => {
      if (this.geoLocationsInfo.get([position.latitudeDegrees, position.longitudeDegrees].join(','))) {
        return resolve(this.geoLocationsInfo.get([position.latitudeDegrees, position.longitudeDegrees].join(',')));
      }
      this.mapsAPILoader.load().then(() => {
        (new google.maps.Geocoder()).geocode({
          'location': {
            lat: position.latitudeDegrees,
            lng: position.longitudeDegrees
          }
        }, (results, status) => {
          if (!status === google.maps.GeocoderStatus.OK || !results || !results.length) {
            return reject(status);
          }
          const geoLocationInfo = results[0].address_components.reduce((geoLocationInfoBuilder: GeoLocationInfo, addressComponent) => {
            switch (addressComponent.types[0]) {
              case 'country': {
                geoLocationInfoBuilder.country = addressComponent.long_name;
                break;
              }
              case 'locality': {
                geoLocationInfoBuilder.city = addressComponent.long_name;
                break;
              }
              case 'administrative_area_level_1': {
                geoLocationInfoBuilder.province = addressComponent.long_name;
                break;
              }
            }
            return geoLocationInfoBuilder;
          }, new GeoLocationInfo(position.latitudeDegrees, position.longitudeDegrees));
          this.geoLocationsInfo.set([position.latitudeDegrees, position.longitudeDegrees].join(','), geoLocationInfo);
          return resolve(geoLocationInfo);
        });
      });
    });
  }
}
