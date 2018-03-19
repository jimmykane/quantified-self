import {DataInterface} from './data.interface';
import {DataSeaLevelPressure} from './data.sea-level-pressure';

describe('DataSeaLevelPressure', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataSeaLevelPressure(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of hpa', function () {
    expect(data.getUnit()).toBe('hpa');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Sea Level Pressure',
      value: 60
    });
  });
});
