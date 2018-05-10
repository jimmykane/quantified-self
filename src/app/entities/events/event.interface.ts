import {PointInterface} from '../points/point.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {StatsClassInterface} from '../stats/stats.class.interface';
import {ActivityInterface} from '../activities/activity.interface';

export interface EventInterface extends StatsClassInterface, SerializableClassInterface {

  name: string;

  addActivity(activity: ActivityInterface);

  removeActivity(activity: ActivityInterface);

  getActivities(): ActivityInterface[];

  getFirstActivity(): ActivityInterface;

  getLastActivity(): ActivityInterface;

  getPoints(startDate?: Date, endDate?: Date, activities?: ActivityInterface[]): PointInterface[];

  getPointsWithPosition(startDate?: Date, endDate?: Date, activities?: ActivityInterface[]): PointInterface[];

  hasPointsWithPosition(startDate?: Date, endDate?: Date, activities?: ActivityInterface[]): boolean;
}
