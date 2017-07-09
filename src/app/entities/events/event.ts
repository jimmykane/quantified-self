import {EventInterface} from './event.interface';
import {GeodesyAdapterInterface} from '../geodesy/adapters/adapter.interface';
import {GeoLibAdapter} from '../geodesy/adapters/geolib.adapter';
import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from '../data/data.interface';
import {LapInterface} from '../laps/lap.interface';
import {Log, Level} from 'ng2-logger'


export class Event extends IDClass implements EventInterface {

  private name: string;
  private activities: ActivityInterface[] = [];
  private laps: LapInterface[] = [];
  private geodesyAdapter: GeodesyAdapterInterface;
  private logger = Log.create(this.constructor.name);

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
      return activityA.getStartDate() < activityB.getStartDate() ? activityA : activityB;
    });
  }

  getLastActivity(): ActivityInterface {
    return this.getActivities().reduce((activityA: ActivityInterface, activityB: ActivityInterface) => {
      return activityA.getStartDate() < activityB.getStartDate() ? activityB : activityA;
    });
  }

  addLap(lap: LapInterface) {
    this.laps.push(lap);
  }

  getLaps(): LapInterface[] {
    return this.laps;
  }

  getPoints(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): PointInterface[] {
    const t0 = performance.now();
    const points = (activities || this.getActivities()).reduce((pointsArray: PointInterface[], activity: ActivityInterface) => {
      return [...pointsArray, ...activity.getPoints(startDate, endDate, step)];
    }, []);
    this.logger.d('Retrieved all points after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return points;
  }

  getPointsWithPosition(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): PointInterface[] {
    const t0 = performance.now();
    const points = this.getPoints(startDate, endDate, step, activities)
      .reduce((pointsWithPosition: PointInterface[], point: PointInterface) => {
        if (point.getPosition()) {
          pointsWithPosition.push(point);
        }
        return pointsWithPosition;
      }, []);
    this.logger.d('Retrieved all points after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return points;
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
            existingDataArray.push(pointData)
          });
        });
        return dataMap;
      }, new Map<string, DataInterface[]>());
    this.logger.d('Retrieved all data after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return data;
  }

  getDataByType(dataType: string, startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): DataInterface[] {
    const t0 = performance.now();
    const data = this.getPoints(startDate, endDate, step, activities)
      .reduce((dataArray: DataInterface[], point: PointInterface, currentIndex) => {
        point.getDataByType(dataType).forEach((pointData: DataInterface) => {
          dataArray.push(pointData);
        });
        return dataArray;
      }, []);
    this.logger.d('Retrieved data for  ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return data;
  }

  getDataTypeAverage(dataType: string, startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): number {
    const t0 = performance.now();
    let count = 1;
    const averageForDataType = this.getPoints(startDate, endDate, step, activities).reduce((average: number, point: PointInterface) => {
      if (!point.getDataTypeAverage(dataType)) {
        return average;
      }
      average += point.getDataTypeAverage(dataType);
      count++;
      return average;
    }, 0);
    this.logger.d('Activity: Calculated average for ' + dataType + ' after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return averageForDataType / count;
  }

  getDistanceInMeters(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): number {
    return this.getGeodesyAdapter().getDistance(this.getPointsWithPosition(startDate, endDate, step, activities));
  }

  getTotalDurationInSeconds(): number {
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
