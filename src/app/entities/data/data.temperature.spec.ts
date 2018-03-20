import {DataInterface} from './data.interface';
import {DataTemperature} from './data.temperature';

describe('DataTemperature', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataTemperature(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of °C', () => {
    expect(data.getUnit()).toBe('°C');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Temperature',
      value: 60
    });
  });
});
