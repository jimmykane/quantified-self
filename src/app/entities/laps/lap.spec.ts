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
        'totalDurationInSeconds': undefined,
        'totalDistanceInMeters': undefined,
        'geoLocationInfo': null,
        'weather': null,
        'maxAltitudeInMeters': undefined,
        'minAltitudeInMeters': undefined,
        'ascentTimeInSeconds': undefined,
        'descentTimeInSeconds': undefined,
        'ascentInMeters': undefined,
        'descentInMeters': undefined,
        'epoc': undefined,
        'energyInCal': undefined,
        'feeling': undefined,
        'pauseDurationInSeconds': undefined,
        'peakTrainingEffect': undefined,
        'recoveryTimeInSeconds': undefined,
        'maxVO2': undefined,
        'minHR': undefined,
        'maxHR': undefined,
        'avgHR': undefined,
        'avgPower': undefined,
        'minPower': undefined,
        'maxPower': undefined,
        'avgTemperature': undefined,
        'minTemperature': undefined,
        'maxTemperature': undefined,
        'avgCadence': undefined,
        'minCadence': undefined,
        'maxCadence': undefined,
        'maxVerticalSpeed': undefined,
        'minVerticalSpeed': undefined,
        'avgVerticalSpeed': undefined,
        'maxSpeed': undefined,
        'avgSpeed': undefined,
        'minSpeed': undefined,
        'intensityZones': {}
      }
    });

  });
});
