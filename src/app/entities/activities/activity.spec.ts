import {Activity} from './activity';
import {ActivityInterface} from './activity.interface';
import {Point} from '../points/point';
import {DataHeartRate} from "../data/data.heart-rate";
import {DataAltitude} from "../data/data.altitude";
import {DataTemperature} from "../data/data.temperature";

describe('Activity', function () {

  let activity: ActivityInterface;

  beforeEach(() => {
    activity = new Activity();
  });

  it('should have no points', function () {
    expect(activity.getPoints().length).toBe(0);
  });

  it('should add a point', function () {
    activity.addPoint(new Point(new Date()));
    expect(activity.getPoints().length).toBe(1);
  });

  it('should detect duplicate date points and only have one point for the same date', function () {
    activity.addPoint(new Point(new Date(0)));
    activity.addPoint(new Point(new Date(0)));
    expect(activity.getPoints().length).toBe(1);
  });

  it('should detect duplicate date points and only add new data overwritting the first if existing', function () {
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

  it('should detect duplicate date points but not add new data if keepNewPointDataTypeValue is false', function () {
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

  it('should remove a point', function () {
    activity.addPoint(new Point(new Date(0)));
    activity.removePoint(new Point(new Date(0)));
    expect(activity.getPoints().length).toBe(0);
  });


  it('should get points seq after 1s intervals', function () {
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


  it('should get points based on startDate', function () {
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

  it('should get points based on endDate', function () {
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

  it('should get points based on startDate and endDate', function () {
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

  it('should not get points when out of/invalid range', function () {
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

  it('should get points sanitized to the second and merge their data correctly', function () {
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

  // it('should export correctly to JSON', function () {
  //   expect(creator.toJSON()).toEqual({
  //     name: 'name',
  //     serialNumber: 'SerialNumber',
  //     swInfo: 'SWInfo',
  //     hwInfo: 'HWInfo',
  //   });
  // });

});
