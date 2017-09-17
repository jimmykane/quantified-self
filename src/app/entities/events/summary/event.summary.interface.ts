import {Weather} from '../../weather/app.weather';
import {SerializableClassInterface} from '../../serializable/serializable.class.interface';
import {GeoLocationInfo} from '../../geo-location-info/app.geo-location-info';

export interface EventSummaryInterface extends SerializableClassInterface {
  setElapsedTimeInSeconds(elapsedTimeInSeconds: number);
  getElapsedTimeInSeconds(): number;

  setTotalDistanceInMeters(totalDistanceInMeters: number);
  getTotalDistanceInMeters(): number;

  setGeoLocationInfo(geoLocationInfo: GeoLocationInfo);
  getGeoLocationInfo(): GeoLocationInfo;

  setWeather(weather: Weather);
  getWeather(): Weather;
}
