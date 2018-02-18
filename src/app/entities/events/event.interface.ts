import {ActivityInterface} from 'app/entities/activities/activity.interface';
import {PointInterface} from '../points/point.interface';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {DataInterface} from '../data/data.interface';
import {LapInterface} from '../laps/lap.interface';
import {SummaryInterface} from '../summary/summary.interface';

export interface EventInterface extends IDClassInterface, SerializableClassInterface {

  setName(name: string);

  getName(): string;

  addActivity(activity: ActivityInterface);

  removeActivity(activity: ActivityInterface);

  getActivities(): ActivityInterface[];

  getFirstActivity(): ActivityInterface;

  getLastActivity(): ActivityInterface;

  getLaps(): LapInterface[];

  addLap(lap: LapInterface);

  getPoints(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): PointInterface[];

  getPointsWithPosition(startDate?: Date, endDate?: Date, step?: number, activities?: ActivityInterface[]): PointInterface[];

  getDataByType(dataType: string): DataInterface[];

  getTotalDurationInSeconds(): number;

  setSummary(eventSummary: SummaryInterface);
  getSummary(): SummaryInterface;
}
