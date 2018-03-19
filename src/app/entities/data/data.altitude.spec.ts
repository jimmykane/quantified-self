import {DataInterface} from './data.interface';
import {DataAltitude} from './data.altitude';

describe('DataAltitude', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataAltitude(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of meters', function () {
    expect(data.getUnit()).toBe('meters');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Altitude',
      value: 60
    });
  });
});
