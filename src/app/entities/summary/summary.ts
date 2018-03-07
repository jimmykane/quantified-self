import {SummaryInterface} from './summary.interface';
import {Weather} from '../weather/app.weather';
import {GeoLocationInfo} from '../geo-location-info/app.geo-location-info';
import {ZonesInterface} from '../intensity-zones/intensity-zone.interface';

export class Summary implements SummaryInterface {

  private totalDurationInSeconds: number;
  private totalDistanceInMeters: number;
  private maxAltitudeInMeters: number;
  private minAltitudeInMeters: number;
  private ascentTimeInSeconds: number;
  private descentTimeInSeconds: number;
  private ascentInMeters: number;
  private descentInMeters: number;
  private epoc: number;
  private energyInCal: number;
  private feeling: number;
  private pauseDurationInSeconds: number;
  private peakTrainingEffect: number;
  private recoveryTimeInSeconds: number;
  private maxVO2: number;
  private avgHR: number;
  private minHR: number;
  private maxHR: number;
  private avgPower: number;
  private minPower: number;
  private maxPower: number;
  private avgTemperature: number;
  private minTemperature: number;
  private maxTemperature: number;
  private avgCadence: number;
  private minCadence: number;
  private maxCadence: number;
  private maxVerticalSpeed: number;
  private minVerticalSpeed: number;
  private avgVerticalSpeed: number;
  private maxSpeed: number;
  private avgSpeed: number;
  private minSpeed: number;
  private intensityZones: Map<string, ZonesInterface> = new Map<string, ZonesInterface>();

  private geoLocationInfo: GeoLocationInfo;
  private weather: Weather;

  setTotalDurationInSeconds(totalDurationInSeconds: number) {
    this.totalDurationInSeconds = totalDurationInSeconds;
  }

  getTotalDurationInSeconds(): number {
    return this.totalDurationInSeconds;
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


  setMaxAltitudeInMeters(maxAltitudeInMeters: number) {
    this.maxAltitudeInMeters = maxAltitudeInMeters;
  }

  getMaxAltitudeInMeters(): number {
    return this.maxAltitudeInMeters;
  }

  setMinAltitudeInMeters(minAltitudeInMeters: number) {
    this.minAltitudeInMeters = minAltitudeInMeters;
  }

  getMinAltitudeInMeters(): number {
    return this.minAltitudeInMeters;
  }

  setAscentTimeInSeconds(ascentTimeInSeconds: number) {
    this.ascentTimeInSeconds = ascentTimeInSeconds;
  }

  getAscentTimeInSeconds(): number {
    return this.ascentTimeInSeconds;
  }

  setDescentTimeInSeconds(decentTimeInSeconds: number) {
    this.descentTimeInSeconds = decentTimeInSeconds;
  }

  getDescentTimeInSeconds(): number {
    return this.descentTimeInSeconds;
  }

  setAscentInMeters(ascentInMeters: number) {
    this.ascentInMeters = ascentInMeters;
  }

  getAscentInMeters(): number {
    return this.ascentInMeters;
  }

  setDescentInMeters(decentInMeters: number) {
    this.descentInMeters = decentInMeters;
  }

  getDescentInMeters(): number {
    return this.descentInMeters;
  }

  setEPOC(epoc: number) {
    this.epoc = epoc;
  }

  getEPOC(): number {
    return this.epoc;
  }

  setEnergyInCal(energyInCal: number) {
    this.energyInCal = energyInCal;
  }

  getEnergyInCal(): number {
    return this.energyInCal;
  }

  setFeeling(feeling: number) {
    this.feeling = feeling;
  }

  getFeeling(): number {
    return this.feeling;
  }

  setPauseDurationInSeconds(pauseDurationInSeconds: number) {
    this.pauseDurationInSeconds = pauseDurationInSeconds;
  }

  getPauseDurationInSeconds(): number {
    return this.pauseDurationInSeconds;
  }

  setPeakTrainingEffect(peakTrainingEffect: number) {
    this.peakTrainingEffect = peakTrainingEffect;
  }

  getPeakTrainingEffect(): number {
    return this.peakTrainingEffect;
  }

  setRecoveryTimeInSeconds(recoveryTimeInSeconds: number) {
    this.recoveryTimeInSeconds = recoveryTimeInSeconds;
  }

  getRecoveryTimeInSeconds(): number {
    return this.recoveryTimeInSeconds;
  }


  setMaxVO2(maxVO2: number) {
    this.maxVO2 = maxVO2;
  }

  getMaxVO2(): number {
    return this.maxVO2;
  }


  setAvgHR(avgHR: number) {
    this.avgHR = avgHR;
  }

  getAvgHR(): number {
    return this.avgHR;
  }

  setMinHR(minHR: number) {
    this.minHR = minHR;
  }

  getMinHR(): number {
    return this.minHR;
  }

  setMaxHR(maxHR: number) {
    this.maxHR = maxHR;
  }

  getMaxHR(): number {
    return this.maxHR;
  }

  setAvgPower(avgPower: number) {
    this.avgPower = avgPower;
  }

  getAvgPower(): number {
    return this.avgPower;
  }

  setMinPower(minPower: number) {
    this.minPower = minPower;
  }

  getMinPower(): number {
    return this.minPower;
  }

  setMaxPower(maxPower: number) {
    this.maxPower = maxPower;
  }

  getMaxPower(): number {
    return this.maxPower;
  }

  setAvgTemperature(avgTemperature: number) {
    this.avgTemperature = avgTemperature;
  }

  getAvgTemperature(): number {
    return this.avgTemperature;
  }

  setMinTemperature(minTemperature: number) {
    this.minTemperature = minTemperature;
  }

  getMinTemperature(): number {
    return this.minTemperature;
  }

  setMaxTemperature(maxTemperature: number) {
    this.maxTemperature = maxTemperature;
  }

  getMaxTemperature(): number {
    return this.maxTemperature;
  }

  setAvgCadence(avgCadence: number) {
    this.avgCadence = avgCadence;
  }

  getAvgCadence(): number {
    return this.avgCadence;
  }

  setMinCadence(minCadence: number) {
    this.minCadence = minCadence;
  }

  getMinCadence(): number {
    return this.minCadence;
  }

  setMaxCadence(maxCadence: number) {
    this.maxCadence = maxCadence;
  }

  getMaxCadence(): number {
    return this.maxCadence;
  }

  setAvgSpeed(avgSpeed: number) {
    this.avgSpeed = avgSpeed;
  }

  getAvgSpeed(): number {
    return this.avgSpeed;
  }

  setMinSpeed(minSpeed: number) {
    this.minSpeed = minSpeed;
  }

  getMinSpeed(): number {
    return this.minSpeed;
  }

  setMaxSpeed(maxSpeed: number) {
    this.maxSpeed = maxSpeed;
  }

  getMaxSpeed(): number {
    return this.maxSpeed;
  }

  setAvgVerticalSpeed(avgVerticalSpeed: number) {
    this.avgVerticalSpeed = avgVerticalSpeed;
  }

  getAvgVerticalSpeed(): number {
    return this.avgVerticalSpeed;
  }

  setMinVerticalSpeed(minVerticalSpeed: number) {
    this.minVerticalSpeed = minVerticalSpeed;
  }

  getMinVerticalSpeed(): number {
    return this.minVerticalSpeed;
  }

  setMaxVerticalSpeed(maxVerticalSpeed: number) {
    this.maxVerticalSpeed = maxVerticalSpeed;
  }

  getMaxVerticalSpeed(): number {
    return this.maxVerticalSpeed;
  }


  getIntensityZones(): Map<string, ZonesInterface> {
    return this.intensityZones;
  }

  addIntensityZone(zoneName: string, zone: ZonesInterface) {
    this.intensityZones.set(zoneName, zone)
  }

  toJSON(): any {
    const intensityZones = {};
    this.getIntensityZones().forEach((value: ZonesInterface, key: string, map) => {
        intensityZones[key] =  value.toJSON();
    });
    return {
      totalDurationInSeconds: this.getTotalDurationInSeconds(),
      totalDistanceInMeters: this.getTotalDistanceInMeters(),
      geoLocationInfo: this.getGeoLocationInfo() ? this.getGeoLocationInfo().toJSON() : null,
      weather: this.getWeather() ? this.getWeather().toJSON() : null,
      maxAltitudeInMeters: this.getMaxAltitudeInMeters(),
      minAltitudeInMeters: this.getMinAltitudeInMeters(),
      ascentTimeInSeconds: this.getAscentTimeInSeconds(),
      descentTimeInSeconds: this.getDescentTimeInSeconds(),
      ascentInMeters: this.getAscentInMeters(),
      descentInMeters: this.getDescentInMeters(),
      epoc: this.getEPOC(),
      energyInCal: this.getEnergyInCal(),
      feeling: this.getFeeling(),
      pauseDurationInSeconds: this.getPauseDurationInSeconds(),
      peakTrainingEffect: this.getPeakTrainingEffect(),
      recoveryTimeInSeconds: this.getRecoveryTimeInSeconds(),
      maxVO2: this.getMaxVO2(),
      minHR: this.getMinHR(),
      maxHR: this.getMaxHR(),
      avgHR: this.getAvgHR(),
      avgPower: this.getAvgPower(),
      minPower: this.getMinPower(),
      maxPower: this.getMaxPower(),
      avgTemperature: this.getAvgTemperature(),
      minTemperature: this.getMinTemperature(),
      maxTemperature: this.getMaxTemperature(),
      avgCadence: this.getAvgCadence(),
      minCadence: this.getMinCadence(),
      maxCadence: this.getMaxCadence(),
      maxVerticalSpeed: this.getMaxVerticalSpeed(),
      minVerticalSpeed: this.getMinVerticalSpeed(),
      avgVerticalSpeed: this.getAvgVerticalSpeed(),
      maxSpeed: this.getMaxSpeed(),
      avgSpeed: this.getAvgSpeed(),
      minSpeed: this.getMinSpeed(),
      intensityZones: intensityZones,
    };
  }
}
