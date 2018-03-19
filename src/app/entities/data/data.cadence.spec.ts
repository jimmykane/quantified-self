import {DataInterface} from './data.interface';
import {DataCadence} from './data.cadence';

describe('DataCadence', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataCadence(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of spm', function () {
    expect(data.getUnit()).toBe('spm');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Cadence',
      value: 60
    });
  });
});
