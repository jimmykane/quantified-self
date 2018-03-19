import {DataInterface} from './data.interface';
import {DataAbsolutePressure} from './data.absolute-pressure';

describe('DataAbsolutePressure', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataAbsolutePressure(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of hpa', function () {
    expect(data.getUnit()).toBe('hpa');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Absolute Pressure',
      value: 60
    });
  });
});
