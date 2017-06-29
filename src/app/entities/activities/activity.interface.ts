import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {LapInterface} from '../laps/lap.interface';
import {EventInterface} from '../events/event.interface';
import {IDClass} from '../id/id.abstract.class';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {DataInterface} from '../data/data.interface';

export interface ActivityInterface extends IDClassInterface, SerializableClassInterface {
  setType(type: string);
  getType(): string;
  getStartDate(): Date;
  getEndDate(): Date;
  getDurationInSeconds(): number;
  addCreator(creator: CreatorInterface);
  getCreators(): CreatorInterface[];
  addPoint(point: PointInterface);
  getPoints(startDate?: Date, endDate?: Date, step?: number): PointInterface[];
  getData(startDate?: Date, endDate?: Date, step?: number): Map<string, DataInterface[]>;
  getDataByType(dataType?: string, startDate?: Date, endDate?: Date, step?: number): DataInterface[];
  getDataTypeAverage(dataType: string): number;
  getStartPoint(): PointInterface;
  getEndPoint(): PointInterface;
}
