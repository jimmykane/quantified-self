import {LapInterface} from './lap.interface';
import {Lap} from './lap';
import {Summary} from '../summary/summary';

describe('Lap', () => {

  let lap: LapInterface;

  beforeEach(() => {
    lap = new Lap(new Date(0), new Date(100));
    lap.type = 'Auto';
  });

  // Todo should test stats

  it('should export correctly to JSON', () => {
    expect(lap.toJSON()).toEqual({
      'startDate': '1970-01-01T00:00:00.000Z',
      'endDate': '1970-01-01T00:00:00.100Z',
      'type': 'Auto',
      'stats': {},
    });

  });
});
