import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {IDClassInterface} from '../id/id.class.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {SummaryInterface} from '../summary/summary.interface';
import {LapInterface} from '../laps/lap.interface';
import {IBIData} from '../data/ibi/data.ibi';
import {IntensityZonesInterface} from '../intensity-zones/intensity-zone.interface';

export interface ActivityInterface extends IDClassInterface, SerializableClassInterface {
  type: string;
  startDate: Date;
  endDate: Date;
  creator: CreatorInterface;
  summary: SummaryInterface;
  ibiData: IBIData;
  intensityZones: Map<string, IntensityZonesInterface>;


  addPoint(point: PointInterface, overrideAllDataOnCollision?: boolean);
  removePoint(point: PointInterface);
  removePoint(point: PointInterface);
  getPoints(startDate?: Date, endDate?: Date): PointInterface[];
  getPointsInterpolated(startDate?: Date, endDate?: Date): PointInterface[];
  getStartPoint(): PointInterface;
  getEndPoint(): PointInterface;
  getLaps(): LapInterface[];
  addLap(lap: LapInterface);
  sortPointsByDate(): void; // Todo make return
}
