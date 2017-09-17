import {Weather} from '../../../services/weather/app.weather';
import {SerializableClassInterface} from '../../serializable/serializable.class.interface';
import {GeoLocationInfo} from '../../../services/geo-location/app.geo-location-info';

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
