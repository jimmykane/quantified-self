import {DataInterface} from './data.interface';
import {DataLongitudeDegrees} from './data.longitude-degrees';

describe('DataLongitudeDegrees', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataLongitudeDegrees(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of degrees', function () {
    expect(data.getUnit()).toBe('degrees');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Longitude',
      value: 60
    });
  });
});
