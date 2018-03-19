import {DataInterface} from './data.interface';
import {DataVerticalSpeed} from './data.verticalspeed';

describe('DataVerticalSpeed', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataVerticalSpeed(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of m/s', function () {
    expect(data.getUnit()).toBe('m/s');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Vertical Speed',
      value: 60
    });
  });
});
