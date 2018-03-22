import {DataInterface} from './data.interface';
import {DataGPSAltitude} from './data.altitude-gps';

describe('DataAltitudeGPS', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataGPSAltitude(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of meters', () => {
    expect(data.getUnit()).toBe('meters');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Altitude GPS',
      value: 60
    });
  });
});
