import {DataInterface} from './data.interface';
import {DataTemperature} from './data.temperature';
import {Point} from '../points/point';

describe('Data', function () {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataTemperature(60);
  });

  it('should set a point', function () {
    data.setPoint(new Point(new Date()));
    expect(data.getPoint() instanceof Point).toBe(true);
  });

  it('should miss a point', function () {
    expect(data.getPoint()).toBeFalsy();
  });

});
