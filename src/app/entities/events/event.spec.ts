import {EventInterface} from './event.interface';
import {Event} from './event';
import {Activity} from '../activities/activity';
import {Point} from '../points/point';
import {DataLatitudeDegrees} from '../data/data.latitude-degrees';
import {DataLongitudeDegrees} from '../data/data.longitude-degrees';

describe('Event', () => {

  let event: EventInterface;

  beforeEach(() => {
    event = new Event();
  });

  it('should add an activity', () => {
    expect(event.getActivities().length).toBe(0);
    event.addActivity(new Activity());
    expect(event.getActivities().length).toBe(1);
  });

  it('should remove an activity', () => {
    const activity = new Activity();
    event.addActivity(activity);
    expect(event.getActivities().length).toBe(1);
    event.removeActivity(activity);
    expect(event.getActivities().length).toBe(0);
  });


  it('should get the first and the last activity', () => {
    const activityA = new Activity();
    activityA.startDate = new Date(10);
    const activityB = new Activity();
    activityB.startDate = new Date(0);

    event.addActivity(activityA);
    event.addActivity(activityB);

    // Should get them sorted by date
    expect(event.getFirstActivity()).toEqual(activityB);
    expect(event.getLastActivity()).toEqual(activityA);
  });


  it('should get an empty point array if no activity points', () => {
    const activityA = new Activity();
    const activityB = new Activity();

    event.addActivity(activityA);
    event.addActivity(activityB);
    expect(event.getPoints().length).toBe(0);
    expect(event.getPoints(null, null, [activityA]).length).toBe(0);
    expect(event.getPoints(null, null, [activityB]).length).toBe(0);
  });


  it('should get the correct points', () => {
    const activityA = new Activity();
    activityA.addPoint(new Point(new Date(0)));
    activityA.addPoint(new Point(new Date(10)));
    activityA.addPoint(new Point(new Date(20)));
    activityA.addPoint(new Point(new Date(30)));
    const activityB = new Activity();
    activityB.addPoint(new Point(new Date(0)));
    activityB.addPoint(new Point(new Date(10)));
    activityB.addPoint(new Point(new Date(20)));

    const activityC = new Activity();
    activityC.addPoint(new Point(new Date(40)));
    activityC.addPoint(new Point(new Date(50)));

    event.addActivity(activityA);
    event.addActivity(activityB);
    event.addActivity(activityC);
    expect(event.getPoints().length).toBe(9);
    expect(event.getPoints(null, null, [activityA]).length).toBe(4);
    expect(event.getPoints(null, null, [activityB]).length).toBe(3);
    expect(event.getPoints(null, null, [activityC]).length).toBe(2);
    expect(event.getPoints(null, null, [activityA, activityB]).length).toBe(7);
    expect(event.getPoints(null, null, [activityA, activityC]).length).toBe(6);
    expect(event.getPoints(null, null, [activityB, activityC]).length).toBe(5);
  });


  it('should get a zero array if no points with position', () => {
    expect(event.getPointsWithPosition().length).toBe(0);
  });

  it('should get the points with position', () => {
    const activity = new Activity();
    let point = new Point(new Date(0));
    point.addData(new DataLatitudeDegrees(0));
    point.addData(new DataLongitudeDegrees(0));
    activity.addPoint(point);
    event.addActivity(activity);

    expect(event.getPointsWithPosition().length).toBe(1);
    // Add another point
    point = new Point(new Date(10));
    point.addData(new DataLatitudeDegrees(0));
    point.addData(new DataLongitudeDegrees(0));
    activity.addPoint(point);
    expect(event.getPointsWithPosition().length).toBe(2);
  });

  it('should get return false if no points with position', () => {
    expect(event.hasPointsWithPosition()).toBe(false);
  });

  it('should get return true if points with position', () => {
    const activity = new Activity();
    const point = new Point(new Date());
    point.addData(new DataLatitudeDegrees(0));
    point.addData(new DataLongitudeDegrees(0));
    activity.addPoint(point);
    event.addActivity(activity);
    expect(event.hasPointsWithPosition()).toBe(true);
  });

  it('should get return false if points with position when an activity is removed', () => {
    const activity = new Activity();
    const point = new Point(new Date());
    point.addData(new DataLatitudeDegrees(0));
    point.addData(new DataLongitudeDegrees(0));
    activity.addPoint(point);
    event.addActivity(activity);
    expect(event.hasPointsWithPosition()).toBe(true);
    event.removeActivity(activity);
    expect(event.hasPointsWithPosition()).toBe(false);
  });

  it('should export correctly to JSON', () => {
    const activity = new Activity();
    event.addActivity(activity);
    event.setID('123');
    spyOn(activity, 'toJSON').and.returnValue({});
    expect(event.toJSON()).toEqual({
      'id': '123',
      'name': undefined,
      'activities': [{}],
      'stats': []
    });
  });
});
