import {DataInterface} from './data.interface';
import {DataTemperature} from './data.temperature';
import {Point} from '../points/point';

describe('Data', () => {

  let data: DataInterface;

  beforeEach(() => {
    data = new DataTemperature(60);
  });

  it('should set a point', () => {
    data.setPoint(new Point(new Date()));
    expect(data.getPoint() instanceof Point).toBe(true);
  });

  it('should miss a point', () => {
    expect(data.getPoint()).toBeFalsy();
  });

});
