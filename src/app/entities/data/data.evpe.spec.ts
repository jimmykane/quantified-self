import {DataInterface} from './data.interface';
import {DataEVPE} from './data.evpe';

describe('DataEVPE', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataEVPE(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of none', function () {
    expect(data.getUnit()).toBe('');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'EVPE',
      value: 60
    });
  });
});
