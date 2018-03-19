import {DataInterface} from './data.interface';
import {DataNumberOfSatellites} from './data.number-of-satellites';

describe('DataNumberOfSatellites', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataNumberOfSatellites(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of none', function () {
    expect(data.getUnit()).toBe('');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Number of Satellites',
      value: 60
    });
  });
});
