import {ActivityInterface} from 'app/entities/activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {DataInterface} from '../data/data.interface';
import {LapInterface} from '../laps/lap.interface';
import {SummaryInterface} from '../summary/summary.interface';

export interface EventInterface extends IDClassInterface, SerializableClassInterface {

  summary: SummaryInterface;
  name: string;

  addActivity(activity: ActivityInterface);

  removeActivity(activity: ActivityInterface);

  getActivities(): ActivityInterface[];

  getFirstActivity(): ActivityInterface;

  getLastActivity(): ActivityInterface;

  getPoints(startDate?: Date, endDate?: Date, activities?: ActivityInterface[]): PointInterface[];

  getPointsWithPosition(startDate?: Date, endDate?: Date, activities?: ActivityInterface[]): PointInterface[];

  hasPointsWithPosition(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): boolean;

  getDataByType(dataType: string): DataInterface[];

  getTotalDurationInSeconds(): number;

}
