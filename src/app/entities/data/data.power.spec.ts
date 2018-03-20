import {DataInterface} from './data.interface';
import {DataPower} from './data.power';

describe('DataPower', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataPower(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of watts', () => {
    expect(data.getUnit()).toBe('watts');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Power',
      value: 60
    });
  });
});
