import {Weather} from '../weather/app.weather';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {GeoLocationInfo} from '../geo-location-info/app.geo-location-info';
import {Zones} from "../intensity-zones/intensity-zone";
import {ZonesInterface} from "../intensity-zones/intensity-zone.interface";

export interface SummaryInterface extends SerializableClassInterface {

  totalDurationInSeconds: number;

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

  setAvgPower(avgPower: number);
  getAvgPower(): number

  setMinPower(minPower: number);
  getMinPower(): number

  setMaxPower(maxPower: number);
  getMaxPower(): number

  setAvgTemperature(avgTemperature: number);
  getAvgTemperature(): number

  setMinTemperature(minTemperature: number);
  getMinTemperature(): number

  setMaxTemperature(maxTemperature: number);
  getMaxTemperature(): number

  setAvgCadence(avgCadence: number);
  getAvgCadence(): number

  setMinCadence(minCadence: number);
  getMinCadence(): number

  setMaxCadence(maxCadence: number);
  getMaxCadence(): number

  setAvgSpeed(avgSpeed: number);
  getAvgSpeed(): number

  setMinSpeed(minSpeed: number);
  getMinSpeed(): number

  setMaxSpeed(maxSpeed: number);
  getMaxSpeed(): number

  setAvgVerticalSpeed(avgVerticalSpeed: number);
  getAvgVerticalSpeed(): number

  setMinVerticalSpeed(minVerticalSpeed: number);
  getMinVerticalSpeed(): number

  setMaxVerticalSpeed(maxVerticalSpeed: number);
  getMaxVerticalSpeed(): number

  getIntensityZones(): Map<string, ZonesInterface>;
  addIntensityZone(zonesName: string, zone: ZonesInterface);
}
