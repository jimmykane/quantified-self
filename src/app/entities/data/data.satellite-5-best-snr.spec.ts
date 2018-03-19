import {DataInterface} from './data.interface';
import {DataPower} from './data.power';
import {DataSatellite5BestSNR} from './data.satellite-5-best-snr';

describe('DataSatellite5BestSNR', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataSatellite5BestSNR(60);
  });

  it('should get a value of 60', function () {
    expect(data.getValue()).toBe(60);
  });

  it('should get the unit of none', function () {
    expect(data.getUnit()).toBe('');
  });

  it('should export correctly to JSON', function () {
    expect(data.toJSON()).toEqual({
      type: 'Satellite 5 Best SNR',
      value: 60
    });
  });
});
