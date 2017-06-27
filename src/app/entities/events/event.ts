import {EventInterface} from './event.interface';
import {GeodesyAdapterInterface} from '../geodesy/adapters/adapter.interface';
import {GeoLibAdapter} from '../geodesy/adapters/geolib.adapter';
import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from '../data/data.interface';
import {LapInterface} from "../laps/lap.interface";

export class Event extends IDClass implements EventInterface {

  private name: string;
  private activities: ActivityInterface[] = [];
  private laps: LapInterface[] = [];
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

  addLap(lap: LapInterface) {
    this.laps.push(lap);
  }

  getLaps(): LapInterface[] {
    return this.laps;
  }

  getPoints(startDate?: Date, endDate?: Date, step?: number): PointInterface[] {
    const t0 = performance.now();
    const points =  this.getActivities().reduce((pointsArray: PointInterface[], activity: ActivityInterface) => {
      return [...pointsArray, ...activity.getPoints(startDate, endDate, step)];
    }, []);
    console.log('Event: Retrieved all points after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return points;
  }

  getPointsWithPosition(startDate?: Date, endDate?: Date, step?: number): PointInterface[] {
    return this.getPoints(startDate, endDate, step).reduce((pointsWithPosition: PointInterface[], point: PointInterface) => {
      if (point.getPosition()) {
        pointsWithPosition.push(point);
      }
      return pointsWithPosition;
    }, []);
  }

  getData(startDate?: Date, endDate?: Date, step?: number): Map<string, DataInterface[]> {
    const t0 = performance.now();
    const data = this.getPoints(startDate, endDate, step)
      .reduce((dataMap: Map<string, DataInterface[]>, point: PointInterface, currentIndex) => {
        point.getData().forEach((pointDataArray: DataInterface[], key: string) => {
          const existingDataArray = dataMap.get(key) || [];
          if (!existingDataArray.length) {
            dataMap.set(key, existingDataArray);
          }
          pointDataArray.forEach((pointData) => {
            existingDataArray.push(pointData )
          });
        });
        return dataMap;
      }, new Map<string, DataInterface[]>());
    console.log('Event: Retrieved all data after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return data;
  }

  getDataByType(dataType: string, startDate?: Date, endDate?: Date, step?: number): DataInterface[] {
    const t0 = performance.now();
    const data = this.getPoints(startDate, endDate, step)
      .reduce((dataArray: DataInterface[], point: PointInterface, currentIndex) => {
        point.getDataByType(dataType).forEach((pointData: DataInterface) => {
          dataArray.push(pointData);
        });
        return dataArray;
      },  []);
    console.log('Event: Retrieved data for  ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return data;
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
      }, []),
      laps: this.getLaps().reduce((jsonLapsArray: any[], lap: LapInterface) => {
        jsonLapsArray.push(lap.toJSON());
        return jsonLapsArray;
      }, [])

    };
  }
}
