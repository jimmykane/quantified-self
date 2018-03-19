import {DataInterface} from './data.interface';
import {DataGPSAltitude} from './data.altitude-gps';

describe('DataAltitudeGPS', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataGPSAltitude(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of meters', function () {
    expect(data.getUnit()).toBe('meters');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Altitude GPS',
      value: 60
    });
  });
});
