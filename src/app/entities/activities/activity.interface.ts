import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {SummaryInterface} from '../summary/summary.interface';
import {LapInterface} from '../laps/lap.interface';
import {IBIData} from '../data/ibi/data.ibi';

export interface ActivityInterface extends IDClassInterface, SerializableClassInterface {
  type: string;
  startDate: Date;
  endDate: Date;

  setCreator(creator: CreatorInterface);
  getCreator(): CreatorInterface;
  addPoint(point: PointInterface);
  removePoint(point: PointInterface);
  removePoint(point: PointInterface);
  getPoints(startDate?: Date, endDate?: Date, step?: number, sanitizeToSecond?: boolean): PointInterface[];
  getPointsInterpolated(startDate?: Date, endDate?: Date, step?: number): PointInterface[];
  getStartPoint(): PointInterface;
  getEndPoint(): PointInterface;
  setSummary(activitySummary: SummaryInterface);
  getSummary(): SummaryInterface;
  setIBIData(ibiData: IBIData);
  getIBIData(): IBIData;
  getLaps(): LapInterface[];
  addLap(lap: LapInterface);
  sortPointsByDate(): void;
}
