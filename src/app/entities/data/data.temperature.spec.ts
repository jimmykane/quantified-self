import {DataInterface} from './data.interface';
import {DataTemperature} from './data.temperature';

describe('DataTemperature', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataTemperature(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of °C', function () {
    expect(data.getUnit()).toBe('°C');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Temperature',
      value: 60
    });
  });
});
