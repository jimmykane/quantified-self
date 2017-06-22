import {EventInterface} from './event.interface';
import {GeodesyAdapterInterface} from '../geodesy/adapters/adapter.interface';
import {GeoLibAdapter} from '../geodesy/adapters/geolib.adapter';
import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from '../data/data.interface';

export class Event extends IDClass implements EventInterface {

  private name: string;
  private activities: ActivityInterface[] = [];
  private geodesyAdapter: GeodesyAdapterInterface;

  constructor(geodesyAdapter?: GeodesyAdapterInterface) {
    super();
    this.geodesyAdapter = geodesyAdapter || new GeoLibAdapter();
  }

  getGeodesyAdapter(): GeodesyAdapterInterface {
    return this.geodesyAdapter;
  }

  setName(name: string) {
    this.name = name;
  }

  getName() {
    console.log('event name');
    return this.name;
  }

  addActivity(activity: ActivityInterface) {
    this.activities.push(activity);
  }

  removeActivity(activityToRemove: ActivityInterface) {
    this.getActivities().splice(this.getActivities().findIndex((activity: ActivityInterface) => {
      return activityToRemove.getID() === activity.getID();
    }), 1);
  }

  getActivities(): ActivityInterface[] {
    return this.activities;
  }

  getFirstActivity(): ActivityInterface {
    return this.getActivities().reduce((activityA: ActivityInterface, activityB: ActivityInterface) => {
      return activityA.getStartDate() < activityB.getStartDate() ? activityA : activityB ;
    }, this.getActivities()[0]);
  }

  getLastActivity(): ActivityInterface {
    return this.getActivities().reduce((activityA: ActivityInterface, activityB: ActivityInterface) => {
      return activityA.getStartDate() < activityB.getStartDate() ? activityB : activityA ;
    });
  }

  getPoints(): PointInterface[] {
    return this.getActivities().reduce((points: PointInterface[], activity: ActivityInterface) => {
      return [...points, ...activity.getPoints()];
    }, []);
  }

  getData(): Map<string, DataInterface[]> {
    return this.getPoints().reduce((dataMap: Map<string, DataInterface[]>, point: PointInterface, currentIndex) => {
      point.getData().forEach((data: DataInterface[], key: string) => {
        dataMap.set(key, [...dataMap.get(key) || [], ...data]);
      });
      return dataMap;
    }, new Map<string, DataInterface[]>());
  }

  getDataByType(dataType: string): DataInterface[] {
    return this.getData().get(dataType);
  }

  getDistanceInMeters(): number {
    return this.getActivities().reduce((distanceInMeters: number, activity: ActivityInterface) => {
      return distanceInMeters + activity.getDistanceInMeters();
    }, 0);
  }

  getDurationInSeconds(): number {
    return this.getActivities().reduce((durationInSeconds: number, activity: ActivityInterface) => {
      return durationInSeconds + activity.getDurationInSeconds();
    }, 0);
  }

  toJSON(): any {
    return {
      id: this.getID(),
      name: this.getName(),
      activities: this.getActivities().reduce((jsonActivitiesArray: any[], activity: ActivityInterface) => {
        jsonActivitiesArray.push(activity.toJSON());
        return jsonActivitiesArray;
      }, [])
    };
  }
}
