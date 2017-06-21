import {PointInterface} from "../../../points/point.interface";

export interface DistanceAdapterInterface {
  getDistance(points: PointInterface[]): number;
}
