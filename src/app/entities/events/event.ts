import {EventInterface} from './event.interface';
import {ActivityInterface} from '../activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {IDClass} from '../id/id.abstract.class';
import {DataInterface} from '../data/data.interface';
import {LapInterface} from '../laps/lap.interface';
import {Log} from 'ng2-logger'
import {SummaryInterface} from '../summary/summary.interface';

export class Event extends IDClass implements EventInterface {
  public summary: SummaryInterface;

  public name: string;
  private activities: ActivityInterface[] = [];
  private _hasPointsWithPosition;


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
      return activityA.startDate < activityB.startDate ? activityA : activityB;
    });
  }

  getLastActivity(): ActivityInterface {
    return this.getActivities().reduce((activityA: ActivityInterface, activityB: ActivityInterface) => {
      return activityA.startDate < activityB.startDate ? activityB : activityA;
    });
  }

  getPoints(startDate?: Date, endDate?: Date, activities?: ActivityInterface[]): PointInterface[] {
    return (activities || this.getActivities()).reduce((pointsArray: PointInterface[], activity: ActivityInterface) => {
      return pointsArray.concat(activity.getPoints(startDate, endDate));
    }, []);
  }

  getPointsWithPosition(startDate?: Date, endDate?: Date,  activities?: ActivityInterface[]): PointInterface[] {
    return this.getPoints(startDate, endDate, activities)
      .reduce((pointsWithPosition: PointInterface[], point: PointInterface) => {
        if (point.getPosition()) {
          pointsWithPosition.push(point);
        }
        return pointsWithPosition;
      }, []);
  }

  // @todo proper implementation for this query
  hasPointsWithPosition(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): boolean {
    // If not bool = not set
    if (this._hasPointsWithPosition !== true && this._hasPointsWithPosition !== false) {
      this._hasPointsWithPosition = this.getPointsWithPosition(startDate, endDate, activities).length > 0;
    }
    return this._hasPointsWithPosition;
  }

  getTotalDurationInSeconds(): number {
    return this.getActivities().reduce((durationInSeconds: number, activity: ActivityInterface) => {
      return durationInSeconds + activity.summary.totalDurationInSeconds;
    }, 0);
  }

  toJSON(): any {
    return {
      id: this.getID(),
      name: this.name,
      activities: this.getActivities().reduce((jsonActivitiesArray: any[], activity: ActivityInterface) => {
        jsonActivitiesArray.push(activity.toJSON());
        return jsonActivitiesArray;
      }, []),
      summary: this.summary.toJSON()
    };
  }
}
