import {SummaryInterface} from './summary.interface';
import {DataHeartRate} from '../data/data.heart-rate';
import {Summary} from './summary';
import {Weather} from '../weather/app.weather';
import {WeatherItem} from '../weather/app.weather.item';
import {GeoLocationInfo} from '../geo-location-info/app.geo-location-info';
import {Zones} from '../intensity-zones/intensity-zone';

describe('Summary', function () {

  let summary: SummaryInterface;

  beforeEach(() => {
    summary = new Summary();
  });

  it('should export correctly to JSON', function () {
    summary.totalDistanceInMeters = 1;
    summary.totalDurationInSeconds = 2;
    summary.maxAltitudeInMeters = 3;
    summary.minAltitudeInMeters = 4;
    summary.ascentTimeInSeconds = 5;
    summary.descentTimeInSeconds = 6;
    summary.ascentInMeters = 7;
    summary.descentInMeters = 8;
    summary.epoc = 9;
    summary.energyInCal = 10;
    summary.feeling = 11;
    summary.peakTrainingEffect = 12;
    summary.pauseDurationInSeconds = 13;
    summary.recoveryTimeInSeconds = 14;
    summary.maxVO2 = 15;
    summary.avgHR = 16;
    summary.maxHR = 17;
    summary.minHR = 18;
    summary.minPower = 19;
    summary.avgPower = 20;
    summary.maxPower = 21;
    summary.minCadence = 22;
    summary.maxCadence = 23;
    summary.avgCadence = 24;
    summary.maxSpeed = 25;
    summary.minSpeed = 26;
    summary.avgSpeed = 27;
    summary.minVerticalSpeed = 28;
    summary.maxVerticalSpeed = 29;
    summary.avgVerticalSpeed = 30;
    summary.minTemperature = 31;
    summary.maxTemperature = 32;
    summary.avgTemperature = 33;
    summary.pauseDurationInSeconds = 34;
    summary.weather = new Weather(
      [new WeatherItem(
        new Date(0),
        'Test',
        0
      )]
    );

    summary.geoLocationInfo = new GeoLocationInfo(0, 0);
    summary.geoLocationInfo.city = 'Buzan';
    summary.geoLocationInfo.country = 'France';
    summary.geoLocationInfo.province = 'Ariege';

    const zones = new Zones();
    zones.zone1Duration = 1;
    zones.zone2Duration = 2;
    zones.zone2LowerLimit = 3;
    zones.zone3Duration = 4;
    zones.zone3LowerLimit = 5;
    zones.zone4Duration = 6;
    zones.zone4LowerLimit = 7;
    zones.zone5Duration = 8;
    zones.zone5LowerLimit = 9;
    summary.intensityZones.set('Test', zones);

    expect(summary.toJSON()).toEqual({
      'totalDurationInSeconds': 2,
      'totalDistanceInMeters': 1,
      'geoLocationInfo': {
        'latitude': 0,
        'longitude': 0,
        'city': 'Buzan',
        'country': 'France',
        'province': 'Ariege'
      },
      'weather': {
        'weatherItems': [
          {
            'date': '1970-01-01T00:00:00.000Z',
            'conditions': 'Test',
            'temperatureInCelsius': 0
          }
        ]
      },
      'maxAltitudeInMeters': 3,
      'minAltitudeInMeters': 4,
      'ascentTimeInSeconds': 5,
      'descentTimeInSeconds': 6,
      'ascentInMeters': 7,
      'descentInMeters': 8,
      'epoc': 9,
      'energyInCal': 10,
      'feeling': 11,
      'pauseDurationInSeconds': 34,
      'peakTrainingEffect': 12,
      'recoveryTimeInSeconds': 14,
      'maxVO2': 15,
      'minHR': 18,
      'maxHR': 17,
      'avgHR': 16,
      'avgPower': 20,
      'minPower': 19,
      'maxPower': 21,
      'avgTemperature': 33,
      'minTemperature': 31,
      'maxTemperature': 32,
      'avgCadence': 24,
      'minCadence': 22,
      'maxCadence': 23,
      'maxVerticalSpeed': 29,
      'minVerticalSpeed': 28,
      'avgVerticalSpeed': 29,
      'maxSpeed': 25,
      'avgSpeed': 27,
      'minSpeed': 26,
      'intensityZones': {
        'Test': {
          'zone1Duration': 1,
          'zone2Duration': 2,
          'zone2LowerLimit': 3,
          'zone3Duration': 4,
          'zone3LowerLimit': 5,
          'zone4Duration': 6,
          'zone4LowerLimit': 7,
          'zone5Duration': 8,
          'zone5LowerLimit': 9
        }
      }
    });
  });
});
