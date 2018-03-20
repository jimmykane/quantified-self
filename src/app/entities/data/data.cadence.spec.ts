import {DataInterface} from './data.interface';
import {DataCadence} from './data.cadence';

describe('DataCadence', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataCadence(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of spm', () => {
    expect(data.getUnit()).toBe('spm');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Cadence',
      value: 60
    });
  });
});
