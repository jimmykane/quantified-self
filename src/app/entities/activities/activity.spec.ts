import {Activity} from './activity';
import {ActivityInterface} from './activity.interface';
import {Point} from '../points/point';
import {DataHeartRate} from '../data/data.heart-rate';
import {DataAltitude} from '../data/data.altitude';
import {DataTemperature} from '../data/data.temperature';
import {Lap} from '../laps/lap';

describe('Activity', () => {

  let activity: ActivityInterface;

  beforeEach(() => {
    activity = new Activity();
    activity.setID('123');
  });

  it('should have no points', () => {
    expect(activity.getPoints().length).toBe(0);
  });

  it('should add a point', () => {
    activity.addPoint(new Point(new Date()));
    expect(activity.getPoints().length).toBe(1);
  });

  it('should get a start point', () => {
    const point = new Point(new Date());
    activity.addPoint(point);
    expect(activity.getStartPoint()).toEqual(point);
  });

  it('should get an end point', () => {
    const point = new Point(new Date());
    activity.addPoint(point);
    expect(activity.getEndPoint()).toEqual(point);
  });

  it('should get a start and end point', () => {
    const pointA = new Point(new Date());
    const pointB = new Point(new Date());
    activity.addPoint(pointA);
    activity.addPoint(pointB);
    expect(activity.getStartPoint()).toEqual(pointA);
    expect(activity.getEndPoint()).toEqual(pointB);
  });

  it('should not get a start or end point', () => {
    expect(activity.getStartPoint()).toBeFalsy();
    expect(activity.getEndPoint()).toBeFalsy();
  });

  it('should detect duplicate date points and only have one point for the same date', () => {
    activity.addPoint(new Point(new Date(0)));
    activity.addPoint(new Point(new Date(0)));
    expect(activity.getPoints().length).toBe(1);
  });

  it('should detect duplicate date points and only add new data overwritting the first if existing', () => {
    const pointA = new Point(new Date(0));
    pointA.addData(new DataHeartRate(60));
    pointA.addData(new DataTemperature(10));
    const pointB = new Point(new Date(0));
    pointB.addData(new DataHeartRate(100));
    pointB.addData(new DataAltitude(1000));
    activity.addPoint(pointA);
    activity.addPoint(pointB);
    expect(activity.getPoints()[0].getDataByType(DataHeartRate.type).getValue()).toBe(100);
    expect(activity.getPoints()[0].getDataByType(DataAltitude.type).getValue()).toBe(1000);
    expect(activity.getPoints()[0].getDataByType(DataTemperature.type).getValue()).toBe(10);
  });

  it('should detect duplicate date points but not add new data if keepNewPointDataTypeValue is false', () => {
    const pointA = new Point(new Date(0));
    pointA.addData(new DataHeartRate(60));
    pointA.addData(new DataTemperature(10));
    const pointB = new Point(new Date(0));
    pointB.addData(new DataHeartRate(100));
    pointB.addData(new DataAltitude(1000));
    activity.addPoint(pointA);
    activity.addPoint(pointB, true);
    expect(activity.getPoints()[0].getDataByType(DataHeartRate.type).getValue()).toBe(100);
    expect(activity.getPoints()[0].getDataByType(DataAltitude.type).getValue()).toBe(1000);
    expect(activity.getPoints()[0].getDataByType(DataTemperature.type)).toBeFalsy();
  });

  it('should remove a point', () => {
    activity.addPoint(new Point(new Date(0)));
    activity.removePoint(new Point(new Date(0)));
    expect(activity.getPoints().length).toBe(0);
  });


  it('should get points seq after 1s intervals', () => {
    const now = new Date();
    const nowAfter1Second = new Date(now.setSeconds(now.getSeconds() + 1));
    const nowAfter2Second = new Date(now.setSeconds(now.getSeconds() + 2));
    const nowAfter3Second = new Date(now.setSeconds(now.getSeconds() + 3));
    const nowAfter4Second = new Date(now.setSeconds(now.getSeconds() + 4));

    activity.addPoint(new Point(nowAfter1Second));
    activity.addPoint(new Point(nowAfter2Second));
    activity.addPoint(new Point(nowAfter3Second));
    activity.addPoint(new Point(nowAfter4Second));
    expect(activity.getPoints().length).toBe(4);
  });


  it('should get points based on startDate', () => {
    const now = new Date();
    const nowAfter1Second = new Date(now.setSeconds(now.getSeconds() + 1));
    const nowAfter2Second = new Date(now.setSeconds(now.getSeconds() + 2));
    const nowAfter3Second = new Date(now.setSeconds(now.getSeconds() + 3));
    const nowAfter4Second = new Date(now.setSeconds(now.getSeconds() + 4));

    activity.addPoint(new Point(nowAfter1Second));
    activity.addPoint(new Point(nowAfter2Second));
    activity.addPoint(new Point(nowAfter3Second));
    activity.addPoint(new Point(nowAfter4Second));
    expect(activity.getPoints(nowAfter1Second).length).toBe(4);
    expect(activity.getPoints(nowAfter2Second).length).toBe(3);
    expect(activity.getPoints(nowAfter3Second).length).toBe(2);
    expect(activity.getPoints(nowAfter4Second).length).toBe(1);
  });

  it('should get points based on endDate', () => {
    const now = new Date();
    const nowAfter1Second = new Date(now.setSeconds(now.getSeconds() + 1));
    const nowAfter2Second = new Date(now.setSeconds(now.getSeconds() + 2));
    const nowAfter3Second = new Date(now.setSeconds(now.getSeconds() + 3));
    const nowAfter4Second = new Date(now.setSeconds(now.getSeconds() + 4));

    activity.addPoint(new Point(nowAfter1Second));
    activity.addPoint(new Point(nowAfter2Second));
    activity.addPoint(new Point(nowAfter3Second));
    activity.addPoint(new Point(nowAfter4Second));
    expect(activity.getPoints(null, nowAfter1Second).length).toBe(1);
    expect(activity.getPoints(null, nowAfter2Second).length).toBe(2);
    expect(activity.getPoints(null, nowAfter3Second).length).toBe(3);
    expect(activity.getPoints(null, nowAfter4Second).length).toBe(4);
  });

  it('should get points based on startDate and endDate', () => {
    const now = new Date();
    const nowAfter1Second = new Date(now.setSeconds(now.getSeconds() + 1));
    const nowAfter2Second = new Date(now.setSeconds(now.getSeconds() + 2));
    const nowAfter3Second = new Date(now.setSeconds(now.getSeconds() + 3));
    const nowAfter4Second = new Date(now.setSeconds(now.getSeconds() + 4));

    activity.addPoint(new Point(nowAfter1Second));
    activity.addPoint(new Point(nowAfter2Second));
    activity.addPoint(new Point(nowAfter3Second));
    activity.addPoint(new Point(nowAfter4Second));

    // 1-1
    expect(activity.getPoints(nowAfter1Second, nowAfter1Second).length).toBe(1);
    expect(activity.getPoints(nowAfter2Second, nowAfter2Second).length).toBe(1);
    expect(activity.getPoints(nowAfter3Second, nowAfter3Second).length).toBe(1);
    expect(activity.getPoints(nowAfter4Second, nowAfter4Second).length).toBe(1);

    // 2-2
    expect(activity.getPoints(nowAfter1Second, nowAfter2Second).length).toBe(2);
    expect(activity.getPoints(nowAfter2Second, nowAfter3Second).length).toBe(2);
    expect(activity.getPoints(nowAfter3Second, nowAfter4Second).length).toBe(2);

    // 3-3
    expect(activity.getPoints(nowAfter1Second, nowAfter3Second).length).toBe(3);
    expect(activity.getPoints(nowAfter2Second, nowAfter4Second).length).toBe(3);

    // 4
    expect(activity.getPoints(nowAfter1Second, nowAfter4Second).length).toBe(4);
  });

  it('should not get points when out of/invalid range', () => {
    const now = new Date();
    const nowAfter1Second = new Date(now.setSeconds(now.getSeconds() + 1));
    const nowAfter2Second = new Date(now.setSeconds(now.getSeconds() + 2));
    const nowAfter3Second = new Date(now.setSeconds(now.getSeconds() + 3));
    const nowAfter4Second = new Date(now.setSeconds(now.getSeconds() + 4));

    activity.addPoint(new Point(nowAfter1Second));
    activity.addPoint(new Point(nowAfter2Second));
    activity.addPoint(new Point(nowAfter3Second));
    activity.addPoint(new Point(nowAfter4Second));
    expect(activity.getPoints(nowAfter4Second, nowAfter1Second).length).toBe(0);
  });

  it('should get points sanitized to the second and merge their data correctly', () => {
    // Create a date based on now and make the ms 200 regardless of the time
    const now = new Date((new Date()).setMilliseconds(200));
    const nowAfter1Second = new Date(now.setSeconds(now.getSeconds() + 1));
    const nowAfter2Second = new Date(now.setSeconds(now.getSeconds() + 2));
    const nowAfter3Second = new Date(now.setSeconds(now.getSeconds() + 3));
    const nowAfter4Second = new Date(now.setSeconds(now.getSeconds() + 4));
    const nowAfter4AndAHalfSecond = new Date(now.setMilliseconds(nowAfter4Second.getMilliseconds() + 300));

    activity.addPoint(new Point(nowAfter1Second));
    activity.addPoint(new Point(nowAfter2Second));
    activity.addPoint(new Point(nowAfter3Second));
    const point4 = new Point(nowAfter4Second);
    point4.addData(new DataHeartRate(60));
    point4.addData(new DataAltitude(1000));
    activity.addPoint(point4);
    const point5 = new Point(nowAfter4AndAHalfSecond);
    point5.addData(new DataHeartRate(100));
    point5.addData(new DataTemperature(10));
    activity.addPoint(point5);

    // Check distribution
    expect(activity.getPointsInterpolated()[0].getDate().getMilliseconds()).toBe(0);
    expect(activity.getPointsInterpolated()[1].getDate().getMilliseconds()).toBe(0);
    expect(activity.getPointsInterpolated()[2].getDate().getMilliseconds()).toBe(0);
    expect(activity.getPointsInterpolated()[3].getDate().getMilliseconds()).toBe(0);
    expect(activity.getPointsInterpolated()[4]).toBeFalsy();

    // Check data
    expect(activity.getPointsInterpolated()[3].getDataByType(DataHeartRate.type).getValue()).toBe(100);
    expect(activity.getPointsInterpolated()[3].getDataByType(DataAltitude.type).getValue()).toBe(1000);
    expect(activity.getPointsInterpolated()[3].getDataByType(DataTemperature.type).getValue()).toBe(10);

    // Check also original
    expect(activity.getPoints().length).toBe(5);

  });


  it('should sort points by date', () => {
    const now = new Date();
    const nowAfter1Second = new Date(now.setSeconds(now.getSeconds() + 1));
    const nowAfter2Second = new Date(now.setSeconds(now.getSeconds() + 2));
    const nowAfter3Second = new Date(now.setSeconds(now.getSeconds() + 3));
    const nowAfter4Second = new Date(now.setSeconds(now.getSeconds() + 4));

    activity.addPoint(new Point(nowAfter4Second));
    activity.addPoint(new Point(nowAfter3Second));
    activity.addPoint(new Point(nowAfter2Second));
    activity.addPoint(new Point(nowAfter1Second));

    // Check that they are not ordered correctly
    expect(activity.getPoints()[0].getDate()).toBe(nowAfter4Second);
    expect(activity.getPoints()[1].getDate()).toBe(nowAfter3Second);
    expect(activity.getPoints()[2].getDate()).toBe(nowAfter2Second);
    expect(activity.getPoints()[3].getDate()).toBe(nowAfter1Second);

    activity.sortPointsByDate();

    // Check again that now they are shorted ok
    expect(activity.getPoints()[0].getDate()).toBe(nowAfter1Second);
    expect(activity.getPoints()[1].getDate()).toBe(nowAfter2Second);
    expect(activity.getPoints()[2].getDate()).toBe(nowAfter3Second);
    expect(activity.getPoints()[3].getDate()).toBe(nowAfter4Second);
  });


  it('should export correctly to JSON', () => {
    const point = new Point(new Date());
    activity.addPoint(point);
    const lap = new Lap(new Date(), new Date());
    activity.addLap(lap);

    spyOn(point, 'toJSON').and.returnValue({});
    spyOn(lap, 'toJSON').and.returnValue({});
    spyOn(activity.ibiData, 'toJSON').and.returnValue([]);
    spyOn(activity.creator, 'toJSON').and.returnValue({});
    expect(activity.toJSON()).toEqual({
      'id': '123',
      'startDate': undefined,
      'endDate': undefined,
      'type': undefined,
      'creator': {},
      'points': [{}],
      'stats': [],
      'ibiData': [],
      'laps': [{}],
      'intensityZones': {},
      'geoLocationInfo': null,
      'weather': null
    });
    expect(point.toJSON).toHaveBeenCalled();
    expect(lap.toJSON).toHaveBeenCalled();
  });

});
