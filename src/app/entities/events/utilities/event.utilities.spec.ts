import {Event} from '../event';
import {Activity} from '../../activities/activity';
import {Point} from '../../points/point';
import {DataHeartRate} from '../../data/data.heart-rate';
import {DataAltitude} from '../../data/data.altitude';
import {EventUtilities} from './event.utilities';
import {DataAbsolutePressure} from '../../data/data.absolute-pressure';

describe('EventUtilities', () => {

  const event = new Event();

  beforeEach(() => {
    const activity = new Activity();
    event.addActivity(activity);
    const pointA = new Point(new Date(0));
    const pointB = new Point(new Date(1));
    const pointC = new Point(new Date(2));

    pointA.addData(new DataHeartRate(0));
    pointB.addData(new DataHeartRate(50));
    pointC.addData(new DataHeartRate(100));

    pointA.addData(new DataAltitude(200));
    pointB.addData(new DataAltitude(300));
    pointC.addData(new DataAltitude(400));

    activity.addPoint(pointA);
    activity.addPoint(pointB);
    activity.addPoint(pointC);
  });

  it('should get the correct minimum for a DataType', () => {
    expect(EventUtilities.getDateTypeMinimum(event, DataHeartRate.type)).toBe(0);
    expect(EventUtilities.getDateTypeMinimum(event, DataAltitude.type)).toBe(200);
    expect(EventUtilities.getDateTypeMinimum(event, DataAbsolutePressure.type)).toBe(null);
  });

  it('should get the correct maximum for a DataType', () => {
    expect(EventUtilities.getDateTypeMaximum(event, DataHeartRate.type)).toBe(100);
    expect(EventUtilities.getDateTypeMaximum(event, DataAltitude.type)).toBe(400);
    expect(EventUtilities.getDateTypeMaximum(event, DataAbsolutePressure.type)).toBe(null);
  });

   it('should get the correct average for a DataType', () => {
    expect(EventUtilities.getDataTypeAverage(event, DataHeartRate.type)).toBe(50);
    expect(EventUtilities.getDataTypeAverage(event, DataAltitude.type)).toBe(300);
    expect(EventUtilities.getDataTypeAverage(event, DataAbsolutePressure.type)).toBe(null);
  });
});
