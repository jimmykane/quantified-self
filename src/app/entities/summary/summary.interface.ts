import {Weather} from '../weather/app.weather';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {GeoLocationInfo} from '../geo-location-info/geo-location-info';
import {ZonesInterface} from '../intensity-zones/intensity-zone.interface';

export interface SummaryInterface extends SerializableClassInterface {

  totalDurationInSeconds: number;
  totalDistanceInMeters: number;
  geoLocationInfo: GeoLocationInfo;
  weather: Weather;
  maxAltitudeInMeters: number;
  minAltitudeInMeters: number;
  ascentTimeInSeconds: number;
  descentTimeInSeconds: number;
  ascentInMeters: number;
  descentInMeters: number;
  epoc: number;
  energyInCal: number;
  feeling: number;
  pauseDurationInSeconds: number;
  peakTrainingEffect: number  ;
  recoveryTimeInSeconds: number;
  maxVO2: number;
  avgHR: number;
  minHR: number;
  maxHR: number;
  avgPower: number;
  minPower: number;
  maxPower: number;
  avgTemperature: number;
  minTemperature: number;
  maxTemperature: number;
  avgCadence: number;
  minCadence: number;
  maxCadence: number;
  avgSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  avgVerticalSpeed: number;
  minVerticalSpeed: number;
  maxVerticalSpeed: number;
  intensityZones: Map<string, ZonesInterface>;
}
