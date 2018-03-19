import {PointInterface} from '../../points/point.interface';
import {DistanceAdapterInterface} from './distance/distance.adapter.interface';

export interface GeoLibAdapterInterface {
  distanceAdapter: DistanceAdapterInterface;
  getDistance(points: PointInterface[], accuracyInMeters?: number, precision?: number): number;
}
