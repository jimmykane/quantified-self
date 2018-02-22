import {SummaryInterface} from '../summary/summary.interface';
import {Weather} from '../weather/app.weather';
import {GeoLocationInfo} from '../geo-location-info/app.geo-location-info';

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

  toJSON(): any {
    return {
      totalDurationInSeconds: this.getTotalDurationInSeconds(),
      totalDistanceInMeters: this.getTotalDistanceInMeters(),
      geoLocationInfo:  this.getGeoLocationInfo() ? this.getGeoLocationInfo().toJSON() : null,
      weather: this.getWeather() ? this.getWeather().toJSON() : null,
      maxAltitudeInMeters: this.getMaxAltitudeInMeters() ,
      minAltitudeInMeters: this.getMinAltitudeInMeters(),
      ascentTimeInSeconds: this.getAscentTimeInSeconds() ,
      descentTimeInSeconds: this.getDescentTimeInSeconds() ,
      ascentInMeters: this.getAscentInMeters() ,
      descentInMeters: this.getDescentInMeters() ,
      epoc: this.getEPOC() ,
      energyInCal: this.getEnergyInCal() ,
      feeling: this.getFeeling() ,
      pauseDurationInSeconds: this.getPauseDurationInSeconds() ,
      peakTrainingEffect: this.getPeakTrainingEffect() ,
      recoveryTimeInSeconds: this.getRecoveryTimeInSeconds() ,
      maxVO2: this.getMaxVO2(),
    };
  }
}
