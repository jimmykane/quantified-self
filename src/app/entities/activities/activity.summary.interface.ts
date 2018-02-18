import {Weather} from '../weather/app.weather';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {GeoLocationInfo} from '../geo-location-info/app.geo-location-info';
import {SummaryInterface} from "../summary/summary.interface";

export interface ActivitySummaryInterface extends SummaryInterface {
  setGeoLocationInfo(geoLocationInfo: GeoLocationInfo);
  getGeoLocationInfo(): GeoLocationInfo;

  setWeather(weather: Weather);
  getWeather(): Weather;
}
