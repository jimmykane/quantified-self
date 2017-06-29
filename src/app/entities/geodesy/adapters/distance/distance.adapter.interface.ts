import {PointInterface} from '../../../points/point.interface';

export interface DistanceAdapterInterface {
  getDistance(points: PointInterface[], accuracyInMeters?: number, precision?: number): number;
}
