import {DataInterface} from './data.interface';
import {DataSatellite5BestSNR} from './data.satellite-5-best-snr';

describe('DataSatellite5BestSNR', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataSatellite5BestSNR(60);
  });

  it('should get a value of 60', () => {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of none', () => {
    expect(data.getUnit()).toBe('');
  });

  it('should export correctly to JSON', () => {
    expect(data.toJSON()).toEqual({
      type: 'Satellite 5 Best SNR',
      value: 60
    });
  });
});
