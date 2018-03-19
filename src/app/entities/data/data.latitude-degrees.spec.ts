import {DataInterface} from './data.interface';
import {DataLatitudeDegrees} from './data.latitude-degrees';

describe('DataLatitudeDegrees', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataLatitudeDegrees(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of degrees', function () {
    expect(data.getUnit()).toBe('degrees');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Latitude',
      value: 60
    });
  });
});
