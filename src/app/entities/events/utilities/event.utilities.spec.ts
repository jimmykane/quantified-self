import {Event} from '../event';
import {Activity} from '../../activities/activity';
import {Point} from '../../points/point';
import {DataHeartRate} from '../../data/data.heart-rate';
import {DataAltitude} from '../../data/data.altitude';
import {EventUtilities} from './event.utilities';
import {DataAbsolutePressure} from '../../data/data.absolute-pressure';
import {DataEnergy} from '../../data/data.energy';
import {DataDistance} from '../../data/data.distance';
import {DataDuration} from '../../data/data.duration';

describe('EventUtilities', () => {

  const event = new Event();

  beforeEach(() => {
    const activity = new Activity();
    activity.startDate = new Date();
    activity.setDuration(new DataDuration(10));
    activity.setDistance(new DataDistance(10));
    activity.addStat(new DataEnergy(10));

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

  it('should get the correct gain for a DataType', () => {
    // Check the current set
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type)).toBe(200);
    // Add more altitude data but this time descending so it would not affect the gain
    let pointA = new Point(new Date(3));
    let pointB = new Point(new Date(4));
    let pointC = new Point(new Date(5));

    pointA.addData(new DataAltitude(400));
    pointB.addData(new DataAltitude(300));
    pointC.addData(new DataAltitude(200));

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);

    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type)).toBe(200);

    // Add more for gain
    pointA = new Point(new Date(6));
    pointB = new Point(new Date(7));
    pointC = new Point(new Date(8));

    pointA.addData(new DataAltitude(400)); // + 200 to prev
    pointB.addData(new DataAltitude(300)); // + 0
    pointC.addData(new DataAltitude(400)); // + 100

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type)).toBe(500);
  });

  it('should get an event as tcx blob', (done) => {
    EventUtilities.getEventAsTCXBloB(event).then((blob) => {
      expect(blob instanceof Blob).toBe(true);
    });
    done();
  });

});
