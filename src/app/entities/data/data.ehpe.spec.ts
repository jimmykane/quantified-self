import {DataInterface} from './data.interface';
import {DataEHPE} from './data.ehpe';

describe('DataEHPE', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataEHPE(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of none', function () {
    expect(data.getUnit()).toBe('');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'EHPE',
      value: 60
    });
  });
});
