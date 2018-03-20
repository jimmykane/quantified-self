import {DataInterface} from './data.interface';
import {DataNumberOfSatellites} from './data.number-of-satellites';

describe('DataNumberOfSatellites', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataNumberOfSatellites(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of none', () => {
    expect(data.getUnit()).toBe('');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Number of Satellites',
      value: 60
    });
  });
});
