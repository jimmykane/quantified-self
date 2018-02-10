import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {Summary} from '../summary/summary';

export interface ActivityInterface extends IDClassInterface, SerializableClassInterface {
  setType(type: string);
  getType(): string;
  getStartDate(): Date;
  getEndDate(): Date;
  getDurationInSeconds(): number;
  addCreator(creator: CreatorInterface);
  getCreators(): CreatorInterface[];
  addPoint(point: PointInterface);
  removePoint(point: PointInterface);
  getPoints(startDate?: Date, endDate?: Date, step?: number): PointInterface[];
  getStartPoint(): PointInterface;
  getEndPoint(): PointInterface;
  setSummary(activitySummary: Summary);
  getSummary(): Summary;
}
