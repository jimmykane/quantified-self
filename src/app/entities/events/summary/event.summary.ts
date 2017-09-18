import {EventSummaryInterface} from './event.summary.interface';
import {GeoLocationInfo} from '../../geo-location-info/app.geo-location-info';
import {Weather} from '../../weather/app.weather';

export class EventSummary implements EventSummaryInterface {

  private elapsedTimeInSeconds: number;
  private totalDistanceInMeters: number;
  private geoLocationInfo: GeoLocationInfo;
  private weather: Weather;

  setElapsedTimeInSeconds(elapsedTimeInSeconds: number) {
    this.elapsedTimeInSeconds = elapsedTimeInSeconds;
  }

  getElapsedTimeInSeconds(): number {
    return this.elapsedTimeInSeconds;
  }

  setTotalDistanceInMeters(totalDistanceInMeters: number) {
    this.totalDistanceInMeters = totalDistanceInMeters;
  }

  getTotalDistanceInMeters(): number {
    return this.totalDistanceInMeters;
  }

  setGeoLocationInfo(geoLocationInfo: GeoLocationInfo) {
    this.geoLocationInfo = geoLocationInfo;
  }

  getGeoLocationInfo(): GeoLocationInfo {
    return this.geoLocationInfo;
  }

  setWeather(weather: Weather) {
    this.weather = weather;
  }

  getWeather(): Weather {
    return this.weather;
  }

  toJSON(): any {
    return {
      elapsedTimeInSecods: this.elapsedTimeInSeconds,
      totalDistanceInMeters: this.totalDistanceInMeters,
    };
  }
}
