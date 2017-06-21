import {PointInterface} from '../../points/point.interface';

export interface GeodesyAdapterInterface {
  getDistance(points: PointInterface[]): number;
}
