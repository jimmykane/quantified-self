import {Injectable} from '@angular/core';
import {MapsAPILoader} from '@agm/core';
import {GeoLocationInfo} from 'quantified-self-lib/lib/geo-location-info/geo-location-info';
import {DataPositionInterface} from 'quantified-self-lib/lib/data/data.position.interface';

declare const google: any;

@Injectable()
export class GeoLocationInfoService {

  private geoLocationsInfo: Map<string, GeoLocationInfo> = new Map<string, GeoLocationInfo>();

  constructor(private mapsAPILoader: MapsAPILoader) {
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
          results = results.reduce((resultsArray, result) => {
            const wantedResults = result.address_components.filter((address_component) => {
              return address_component.types.indexOf('country') !== -1
                || address_component.types.indexOf('locality') !== -1
                || address_component.types.indexOf('administrative_area_level_1') !== -1;
            });
            resultsArray = resultsArray.concat(wantedResults);
            return resultsArray;
          }, []);
          const geoLocationInfo = results.reduce((geoLocationInfoBuilder: GeoLocationInfo, addressComponent) => {
            switch (addressComponent.types[0]) {
              case 'country': {
                geoLocationInfoBuilder.country = geoLocationInfoBuilder.country || addressComponent.long_name;
                break;
              }
              case 'locality': {
                geoLocationInfoBuilder.city = geoLocationInfoBuilder.city || addressComponent.long_name;
                break;
              }
              case 'administrative_area_level_1': {
                geoLocationInfoBuilder.province = geoLocationInfoBuilder.province || addressComponent.long_name;
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
