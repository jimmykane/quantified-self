import {DataInterface} from './data.interface';
import {DataSeaLevelPressure} from './data.sea-level-pressure';

describe('DataSeaLevelPressure', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataSeaLevelPressure(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of hpa', () => {
    expect(data.getUnit()).toBe('hpa');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Sea Level Pressure',
      value: 60
    });
  });
});
