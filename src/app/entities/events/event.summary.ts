import {EventSummaryInterface} from './event.summary.interface';
import {GeoLocationInfo} from '../geo-location-info/app.geo-location-info';
import {Weather} from '../weather/app.weather';
import {Summary} from "../summary/summary";

export class EventSummary extends Summary implements EventSummaryInterface {

  private geoLocationInfo: GeoLocationInfo;
  private weather: Weather;

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
      totalDurationInSeconds: this.getTotalDurationInSeconds(),
      totalDistanceInMeters: this.getTotalDistanceInMeters(),
      geoLocationInfo:  this.getGeoLocationInfo() ? this.getGeoLocationInfo().toJSON() : null,
      weather: this.getWeather() ? this.getWeather().toJSON() : null
    };
  }
}
