import {EventInterface} from './event.interface';
import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from '../data/data.interface';
import {LapInterface} from '../laps/lap.interface';
import {Log} from 'ng2-logger'
import {SummaryInterface} from '../summary/summary.interface';

export class Event extends IDClass implements EventInterface {

  private name: string;
  private activities: ActivityInterface[] = [];
  private summary: SummaryInterface;
  private _hasPointsWithPosition;
  private logger = Log.create('Event');

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

  getPoints(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): PointInterface[] {
    const t0 = performance.now();
    activities = activities || this.getActivities();
    const points = (activities || this.getActivities()).reduce((pointsArray: PointInterface[], activity: ActivityInterface) => {
      return pointsArray.concat(activity.getPoints(startDate, endDate, step));
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
    this.logger.d('Retrieved all points with position after ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return points;
  }

  // @todo proper implementation for this query
  hasPointsWithPosition(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): boolean {
    // If not bool = not set
    if (this._hasPointsWithPosition !== true && this._hasPointsWithPosition !== false) {
      this._hasPointsWithPosition = this.getPointsWithPosition(startDate, endDate, step, activities).length > 0;
    }
    return this._hasPointsWithPosition;
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

  getTotalDurationInSeconds(): number {
    return this.getActivities().reduce((durationInSeconds: number, activity: ActivityInterface) => {
      return durationInSeconds + activity.getSummary().getTotalDurationInSeconds();
    }, 0);
  }

  setSummary(eventSummary: SummaryInterface) {
    this.summary = eventSummary;
  }

  getSummary(): SummaryInterface {
    return this.summary;
  }

  toJSON(): any {
    return {
      id: this.getID(),
      name: this.getName(),
      activities: this.getActivities().reduce((jsonActivitiesArray: any[], activity: ActivityInterface) => {
        jsonActivitiesArray.push(activity.toJSON());
        return jsonActivitiesArray;
      }, []),
      summary: this.summary.toJSON()
    };
  }
}
