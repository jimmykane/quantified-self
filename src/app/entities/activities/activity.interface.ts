import {CreatorInterface} from '../creators/creatorInterface';
import {PointInterface} from '../points/point.interface';
import {SerializableClassInterface} from '../serializable/serializable.class.interface';
import {LapInterface} from '../laps/lap.interface';
import {IBIData} from '../data/ibi/data.ibi';
import {IntensityZonesInterface} from '../intensity-zones/intensity-zone.interface';
import {StatsClassInterface} from '../stats/stats.class.interface';
import {Weather} from '../weather/app.weather';
import {GeoLocationInfo} from '../geo-location-info/geo-location-info';

export interface ActivityInterface extends StatsClassInterface, SerializableClassInterface {
  type: string;
  startDate: Date;
  endDate: Date;
  creator: CreatorInterface;
  ibiData: IBIData;
  intensityZones: Map<string, IntensityZonesInterface>;
  geoLocationInfo: GeoLocationInfo;
  weather: Weather;

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
