import {EventSummaryInterface} from './event.summary.interface';
import {GeoLocationInfo} from '../../geo-location-info/app.geo-location-info';
import {Weather} from '../../weather/app.weather';

export class EventSummary implements EventSummaryInterface {

  setElapsedTimeInSeconds(elapsedTimeInSeconds: number) {
  }

  getElapsedTimeInSeconds(): number {
    return null;
  }

  setTotalDistanceInMeters(totalDistanceInMeters: number) {
  }

  getTotalDistanceInMeters(): number {
    return null;
  }

  setGeoLocationInfo(geoLocationInfo: GeoLocationInfo) {
  }

  getGeoLocationInfo(): GeoLocationInfo {
    return null;
  }

  setWeather(weather: Weather) {
  }

  getWeather(): Weather {
    return null;
  }

  toJSON(): any {
    return null;
  }
}
