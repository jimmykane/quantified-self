import {LapInterface} from './lap.interface';
import {Lap} from './lap';
import {Summary} from '../summary/summary';

describe('Lap', () => {

  let lap: LapInterface;

  beforeEach(() => {
    lap = new Lap(new Date(0), new Date(100));
    lap.type = 'Auto';
    lap.summary = new Summary();
  });


  it('should export correctly to JSON', () => {
    expect(lap.toJSON()).toEqual({
      'startDate': '1970-01-01T00:00:00.000Z',
      'endDate': '1970-01-01T00:00:00.100Z',
      'type': 'Auto',
      'summary': {
        'totalDurationInSeconds': null,
        'totalDistanceInMeters': null,
        'geoLocationInfo': null,
        'weather': null,
        'maxAltitudeInMeters': null,
        'minAltitudeInMeters': null,
        'ascentTimeInSeconds': null,
        'descentTimeInSeconds': null,
        'ascentInMeters': null,
        'descentInMeters': null,
        'epoc': null,
        'energyInCal': null,
        'feeling': null,
        'pauseDurationInSeconds': null,
        'peakTrainingEffect': null,
        'recoveryTimeInSeconds': null,
        'maxVO2': null,
        'minHR': null,
        'maxHR': null,
        'avgHR': null,
        'avgPower': null,
        'minPower': null,
        'maxPower': null,
        'avgTemperature': null,
        'minTemperature': null,
        'maxTemperature': null,
        'avgCadence': null,
        'minCadence': null,
        'maxCadence': null,
        'maxVerticalSpeed': null,
        'minVerticalSpeed': null,
        'avgVerticalSpeed': null,
        'maxSpeed': null,
        'avgSpeed': null,
        'minSpeed': null,
        'intensityZones': {}
      }
    });

  });
});
