import {SummaryInterface} from './summary.interface';
import {Weather} from '../weather/app.weather';
import {GeoLocationInfo} from '../geo-location-info/geo-location-info';
import {IntensityZonesInterface} from '../intensity-zones/intensity-zone.interface';

export class Summary implements SummaryInterface {

  // @todo use vector base class
  public totalDurationInSeconds: number;
  public totalDistanceInMeters: number;
  public maxAltitudeInMeters: number;
  public minAltitudeInMeters: number;
  public ascentTimeInSeconds: number;
  public descentTimeInSeconds: number;
  public ascentInMeters: number;
  public descentInMeters: number;
  public epoc: number;
  public energyInCal: number;
  public feeling: number;
  public pauseDurationInSeconds: number;
  public peakTrainingEffect: number;
  public recoveryTimeInSeconds: number;
  public maxVO2: number;
  public avgHR: number;
  public minHR: number;
  public maxHR: number;
  public avgPower: number;
  public minPower: number;
  public maxPower: number;
  public avgTemperature: number;
  public minTemperature: number;
  public maxTemperature: number;
  public avgCadence: number;
  public minCadence: number;
  public maxCadence: number;
  public maxVerticalSpeed: number;
  public minVerticalSpeed: number;
  public avgVerticalSpeed: number;
  public maxSpeed: number;
  public avgSpeed: number;
  public minSpeed: number;
  public intensityZones: Map<string, IntensityZonesInterface> = new Map<string, IntensityZonesInterface>();
  public geoLocationInfo: GeoLocationInfo;
  public weather: Weather;

  toJSON(): any {
    const intensityZones = {};
    this.intensityZones.forEach((value: IntensityZonesInterface, key: string, map) => {
        intensityZones[key] =  value.toJSON();
    });

    // perhaps check this with JSON stringify how it can be optimized to include the starnder props
    return {
      totalDurationInSeconds: this.totalDurationInSeconds,
      totalDistanceInMeters: this.totalDistanceInMeters,
      geoLocationInfo: this.geoLocationInfo ? this.geoLocationInfo.toJSON() : null,
      weather: this.weather ? this.weather.toJSON() : null,
      maxAltitudeInMeters: this.maxAltitudeInMeters,
      minAltitudeInMeters: this.minAltitudeInMeters,
      ascentTimeInSeconds: this.ascentTimeInSeconds,
      descentTimeInSeconds: this.descentTimeInSeconds,
      ascentInMeters: this.ascentInMeters,
      descentInMeters: this.descentInMeters,
      epoc: this.epoc,
      energyInCal: this.energyInCal,
      feeling: this.feeling,
      pauseDurationInSeconds: this.pauseDurationInSeconds,
      peakTrainingEffect: this.peakTrainingEffect,
      recoveryTimeInSeconds: this.recoveryTimeInSeconds,
      maxVO2: this.maxVO2,
      minHR: this.minHR,
      maxHR: this.maxHR,
      avgHR: this.avgHR,
      avgPower: this.avgPower,
      minPower: this.minPower,
      maxPower: this.maxPower,
      avgTemperature: this.avgTemperature,
      minTemperature: this.minTemperature,
      maxTemperature: this.maxTemperature,
      avgCadence: this.avgCadence,
      minCadence: this.minCadence,
      maxCadence: this.maxCadence,
      maxVerticalSpeed: this.maxVerticalSpeed,
      minVerticalSpeed: this.minVerticalSpeed,
      avgVerticalSpeed: this.avgVerticalSpeed,
      maxSpeed: this.maxSpeed,
      avgSpeed: this.avgSpeed,
      minSpeed: this.minSpeed,
      intensityZones: intensityZones,
    };
  }
}
