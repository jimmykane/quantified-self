import {DataInterface} from './data.interface';
import {DataPower} from './data.power';

describe('DataPower', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataPower(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of watts', function () {
    expect(data.getUnit()).toBe('watts');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Power',
      value: 60
    });
  });
});
