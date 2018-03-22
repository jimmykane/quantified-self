import {DataInterface} from './data.interface';
import {DataAltitude} from './data.altitude';

describe('DataAltitude', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataAltitude(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of meters', () => {
    expect(data.getUnit()).toBe('meters');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Altitude',
      value: 60
    });
  });
});
