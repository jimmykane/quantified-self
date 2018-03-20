import {DataInterface} from './data.interface';
import {DataLongitudeDegrees} from './data.longitude-degrees';

describe('DataLongitudeDegrees', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataLongitudeDegrees(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of degrees', () => {
    expect(data.getUnit()).toBe('degrees');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Longitude',
      value: 60
    });
  });
});
