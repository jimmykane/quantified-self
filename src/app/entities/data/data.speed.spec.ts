import {DataInterface} from './data.interface';
import {DataSpeed} from './data.speed';

describe('DataSpeed', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataSpeed(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of m/s', function () {
    expect(data.getUnit()).toBe('m/s');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Speed',
      value: 60
    });
  });
});
