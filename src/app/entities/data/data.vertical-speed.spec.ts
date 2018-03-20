import {DataInterface} from './data.interface';
import {DataVerticalSpeed} from './data.verticalspeed';

describe('DataVerticalSpeed', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataVerticalSpeed(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of m/s', () => {
    expect(data.getUnit()).toBe('m/s');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Vertical Speed',
      value: 60
    });
  });
});
