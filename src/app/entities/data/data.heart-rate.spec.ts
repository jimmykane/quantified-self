import {DataHeartRate} from './data.heart-rate';
import {DataInterface} from './data.interface';

describe('DataHeartRate', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataHeartRate(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of bpm', () => {
    expect(data.getUnit()).toBe('bpm');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Heart Rate',
      value: 60
    });
  });
});
