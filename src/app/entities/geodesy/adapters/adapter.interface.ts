import {PointInterface} from '../../points/point.interface';

export interface GeoLibAdapterInterface {
  getDistance(points: PointInterface[], accuracyInMeters?: number, precision?: number): number;
}
