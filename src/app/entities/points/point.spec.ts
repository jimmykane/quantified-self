import {PointInterface} from './point.interface';
import {Point} from './point';
import {DataLatitudeDegrees} from '../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../data/data.longitude-degrees';
import {DataHeartRate} from '../data/data.heart-rate';
import {DataAltitude} from '../data/data.altitude';

describe('Point', function () {

  let point: PointInterface;

  beforeEach(() => {
    point = new Point(new Date(0));
  });

  it('should add data', function () {
    point.addData(new DataAltitude(100));
    expect(point.getDataByType(DataAltitude.type).getValue()).toBe(100);
  });

  it('should keep the last added data value', function () {
    point.addData(new DataAltitude(100));
    point.addData(new DataAltitude(200));
    expect(point.getDataByType(DataAltitude.type).getValue()).toBe(200);
  });

  it('should remove data', function () {
    point.addData(new DataHeartRate(60));
    point.removeDataByType(DataHeartRate.type);
    expect(point.getDataByType(DataHeartRate.type)).toBeUndefined();
  });

  it('should get a position', function () {
    point.addData(new DataLatitudeDegrees(0));
    point.addData(new DataLongitudeDegrees(0));
    expect(point.getPosition()).toEqual({
      latitudeDegrees: 0,
      longitudeDegrees: 0,
    });
  });

  it('should not get a position', function () {
    expect(point.getPosition()).toBeUndefined();
  });

  it('should export correctly to JSON', function () {
    point.addData(new DataLatitudeDegrees(0));
    point.addData(new DataLongitudeDegrees(0));
    point.addData(new DataHeartRate(60));
    expect(point.toJSON()).toEqual({
      date: (new Date(0)).toJSON(),
      data: [{
        type: 'Latitude',
        value: 0
      }, {
        type: 'Longitude',
        value: 0
      }, {
        type: 'Heart Rate',
        value: 60
      }]
    });

  });
});
