import {SummaryInterface} from './summary.interface';
import {Weather} from '../weather/app.weather';
import {GeoLocationInfo} from '../geo-location-info/geo-location-info';
import {IntensityZonesInterface} from '../intensity-zones/intensity-zone.interface';

export class Summary implements SummaryInterface {

  // @todo use vector base class
  public totalDurationInSeconds: number = null;
  public totalDistanceInMeters: number = null;
  public maxAltitudeInMeters: number = null;
  public minAltitudeInMeters: number = null;
  public ascentTimeInSeconds: number = null;
  public descentTimeInSeconds: number = null;
  public ascentInMeters: number = null;
  public descentInMeters: number = null;
  public epoc: number = null;
  public energyInCal: number = null;
  public feeling: number = null;
  public pauseDurationInSeconds: number = null;
  public peakTrainingEffect: number = null;
  public recoveryTimeInSeconds: number = null;
  public maxVO2: number = null;
  public avgHR: number = null;
  public minHR: number = null;
  public maxHR: number = null;
  public avgPower: number = null;
  public minPower: number = null;
  public maxPower: number = null;
  public avgTemperature: number = null;
  public minTemperature: number = null;
  public maxTemperature: number = null;
  public avgCadence: number = null;
  public minCadence: number = null;
  public maxCadence: number = null;
  public maxVerticalSpeed: number = null;
  public minVerticalSpeed: number = null;
  public avgVerticalSpeed: number = null;
  public maxSpeed: number = null;
  public avgSpeed: number = null;
  public minSpeed: number = null;
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
