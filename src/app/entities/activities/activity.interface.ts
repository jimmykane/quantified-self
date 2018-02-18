import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {ActivitySummaryInterface} from './activity.summary.interface';

export interface ActivityInterface extends IDClassInterface, SerializableClassInterface {
  setType(type: string);
  getType(): string;
  getStartDate(): Date;
  getEndDate(): Date;
  setCreator(creator: CreatorInterface);
  getCreator(): CreatorInterface;
  addPoint(point: PointInterface);
  removePoint(point: PointInterface);
  getPoints(startDate?: Date, endDate?: Date, step?: number): PointInterface[];
  getStartPoint(): PointInterface;
  getEndPoint(): PointInterface;
  setSummary(activitySummary: ActivitySummaryInterface);
  getSummary(): ActivitySummaryInterface;
  sortPointsByDate(): void;
}
