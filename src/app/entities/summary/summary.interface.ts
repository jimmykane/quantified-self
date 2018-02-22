import {Weather} from '../weather/app.weather';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {GeoLocationInfo} from '../geo-location-info/app.geo-location-info';

export interface SummaryInterface extends SerializableClassInterface {
  setTotalDurationInSeconds(totalDurationInSeconds: number);
  getTotalDurationInSeconds(): number;

  setTotalDistanceInMeters(totalDistanceInMeters: number);
  getTotalDistanceInMeters(): number;

  setGeoLocationInfo(geoLocationInfo: GeoLocationInfo);
  getGeoLocationInfo(): GeoLocationInfo;

  setWeather(weather: Weather);
  getWeather(): Weather;

  setMaxAltitudeInMeters(maxAltitudeInMeters: number);
  getMaxAltitudeInMeters(): number

  setMinAltitudeInMeters(minAltitudeInMeters: number);
  getMinAltitudeInMeters(): number

  setAscentTimeInSeconds(ascentTimeInSeconds: number);
  getAscentTimeInSeconds(): number

  setDescentTimeInSeconds(decentTimeInSeconds: number);
  getDescentTimeInSeconds(): number

  setAscentInMeters(ascentInMeters: number);
  getAscentInMeters(): number

  setDescentInMeters(decentInMeters: number);
  getDescentInMeters(): number

  setEPOC(epoc: number);
  getEPOC(): number

  setEnergyInCal(energy: number);
  getEnergyInCal(): number

  setFeeling(feeling: number);
  getFeeling(): number

  setFeeling(feeling: number);
  getFeeling(): number

  setPauseDurationInSeconds(pauseDurationInSeconds: number);
  getPauseDurationInSeconds(): number

  setPeakTrainingEffect(peakTrainingEffect: number);
  getPeakTrainingEffect(): number

  setRecoveryTimeInSeconds(recoveryTimeInSeconds: number);
  getRecoveryTimeInSeconds(): number

  setMaxVO2(maxVO2: number);
  getMaxVO2(): number

  setAvgHR(avgHR: number);
  getAvgHR(): number

  setMinHR(minHR: number);
  getMinHR(): number

  setMaxHR(maxHR: number);
  getMaxHR(): number
}
