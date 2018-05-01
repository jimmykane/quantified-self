import {Event} from '../event';
import {Activity} from '../../activities/activity';
import {Point} from '../../points/point';
import {DataHeartRate} from '../../data/data.heart-rate';
import {DataAltitude} from '../../data/data.altitude';
import {EventUtilities} from './event.utilities';
import {DataAbsolutePressure} from '../../data/data.absolute-pressure';
import {DataDistance} from '../../data/data.distance';
import {DataDuration} from '../../data/data.duration';
import {EventInterface} from '../event.interface';

describe('EventUtilities', () => {

  let event: EventInterface;

  beforeEach(() => {
    event = new Event();
    const activity = new Activity();
    activity.startDate = new Date();
    activity.setDuration(new DataDuration(10));
    activity.setDistance(new DataDistance(10));
    event.addActivity(activity);
  });

  it('should get the correct minimum for a DataType', () => {
    const pointA = new Point(new Date(0));
    const pointB = new Point(new Date(1));
    const pointC = new Point(new Date(2));

    pointA.addData(new DataHeartRate(0));
    pointB.addData(new DataHeartRate(50));
    pointC.addData(new DataHeartRate(100));

    pointA.addData(new DataAltitude(200));
    pointB.addData(new DataAltitude(300));
    pointC.addData(new DataAltitude(400));

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);

    expect(EventUtilities.getDateTypeMinimum(event, DataHeartRate.type)).toBe(0);
    expect(EventUtilities.getDateTypeMinimum(event, DataAltitude.type)).toBe(200);
    expect(EventUtilities.getDateTypeMinimum(event, DataAbsolutePressure.type)).toBe(null);
  });

  it('should get the correct maximum for a DataType', () => {
    const pointA = new Point(new Date(0));
    const pointB = new Point(new Date(1));
    const pointC = new Point(new Date(2));

    pointA.addData(new DataHeartRate(0));
    pointB.addData(new DataHeartRate(50));
    pointC.addData(new DataHeartRate(100));

    pointA.addData(new DataAltitude(200));
    pointB.addData(new DataAltitude(300));
    pointC.addData(new DataAltitude(400));

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);

    expect(EventUtilities.getDateTypeMaximum(event, DataHeartRate.type)).toBe(100);
    expect(EventUtilities.getDateTypeMaximum(event, DataAltitude.type)).toBe(400);
    expect(EventUtilities.getDateTypeMaximum(event, DataAbsolutePressure.type)).toBe(null);
  });

  it('should get the correct average for a DataType', () => {
    const pointA = new Point(new Date(0));
    const pointB = new Point(new Date(1));
    const pointC = new Point(new Date(2));

    pointA.addData(new DataHeartRate(0));
    pointB.addData(new DataHeartRate(50));
    pointC.addData(new DataHeartRate(100));

    pointA.addData(new DataAltitude(200));
    pointB.addData(new DataAltitude(300));
    pointC.addData(new DataAltitude(400));

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);

    expect(EventUtilities.getDataTypeAverage(event, DataHeartRate.type)).toBe(50);
    expect(EventUtilities.getDataTypeAverage(event, DataAltitude.type)).toBe(300);
    expect(EventUtilities.getDataTypeAverage(event, DataAbsolutePressure.type)).toBe(null);
  });

  it('should get the correct gain for a DataType', () => {
    const pointA = new Point(new Date(0));
    const pointB = new Point(new Date(1));
    const pointC = new Point(new Date(2));

    pointA.addData(new DataAltitude(200)); // Gain 0
    pointB.addData(new DataAltitude(300)); // Gain 100
    pointC.addData(new DataAltitude(400)); // Gain 200

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);

    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type)).toBe(200);
    // Add more altitude data but this time descending so it would not affect the gain
    const pointD = new Point(new Date(3));
    const pointE = new Point(new Date(4));
    const pointF = new Point(new Date(5));

    pointD.addData(new DataAltitude(400)); // Gain 0
    pointE.addData(new DataAltitude(300)); // Gain 0
    pointF.addData(new DataAltitude(200)); // Gain 0

    event.getFirstActivity().addPoint(pointD);
    event.getFirstActivity().addPoint(pointE);
    event.getFirstActivity().addPoint(pointF);

    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type)).toBe(200);

    // Add more for gain
    const pointG = new Point(new Date(6));
    const pointH = new Point(new Date(7));
    const pointI = new Point(new Date(8));

    pointG.addData(new DataAltitude(400)); // Gain 400 (from prev)
    pointH.addData(new DataAltitude(300)); // Gain 400
    pointI.addData(new DataAltitude(400)); // Gain 500

    event.getFirstActivity().addPoint(pointG);
    event.getFirstActivity().addPoint(pointH);
    event.getFirstActivity().addPoint(pointI);
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type)).toBe(500);
  });

  it('should get the correct gain for a DataType with a changed min difference', () => {
    const pointA = new Point(new Date(0));
    const pointB = new Point(new Date(1));
    const pointC = new Point(new Date(2));

    pointA.addData(new DataAltitude(200)); // Gain 0
    pointB.addData(new DataAltitude(300)); // Gain 100
    pointC.addData(new DataAltitude(400)); // Gain 200

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);
    // With a diff of 100,200 the gain should be included
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type, event.getActivities(), 100)).toBe(200);
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type, event.getActivities(), 200)).toBe(200);

    // with a diff of 201 it shouldn't
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type, event.getActivities(), 201)).toBe(0);

    // Add more
    const pointD = new Point(new Date(3));
    const pointE = new Point(new Date(4));
    const pointF = new Point(new Date(5));

    pointD.addData(new DataAltitude(100));
    pointE.addData(new DataAltitude(101));
    pointF.addData(new DataAltitude(102));

    event.getFirstActivity().addPoint(pointD);
    event.getFirstActivity().addPoint(pointE);
    event.getFirstActivity().addPoint(pointF);

    // Up to now we have 200, 300, 400, 100, 101, 102
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type, event.getActivities(), 100)).toBe(200);
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type, event.getActivities(), 1)).toBe(202);
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type, event.getActivities(), 2)).toBe(202);
    expect(EventUtilities.getEventDataTypeGain(event, DataAltitude.type, event.getActivities(), 3)).toBe(200);
  });

  it('should get an event as tcx blob', (done) => {
    const pointA = new Point(new Date(0));
    const pointB = new Point(new Date(1));
    const pointC = new Point(new Date(2));

    pointA.addData(new DataHeartRate(0));
    pointB.addData(new DataHeartRate(50));
    pointC.addData(new DataHeartRate(100));

    pointA.addData(new DataAltitude(200));
    pointB.addData(new DataAltitude(300));
    pointC.addData(new DataAltitude(400));

    event.getFirstActivity().addPoint(pointA);
    event.getFirstActivity().addPoint(pointB);
    event.getFirstActivity().addPoint(pointC);
    EventUtilities.getEventAsTCXBloB(event).then((blob) => {
      expect(blob instanceof Blob).toBe(true);
    });
    done();
  });

});
