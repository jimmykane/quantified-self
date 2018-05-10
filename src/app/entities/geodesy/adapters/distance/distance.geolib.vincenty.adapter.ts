import {DistanceAdapterInterface} from './distance.adapter.interface';
import {PointInterface} from '../../../points/point.interface';
import { getDistance, PositionAsDecimal } from 'geolib';


export class DistanceVincenty implements DistanceAdapterInterface {
  getDistance(points: PointInterface[], accuracyInMeters?: number, precision?: number): number {
    let distance = 0;
    const excludeFirstPointsArray = points.slice(1);
    let pointA = points[0];
    for (const pointB of excludeFirstPointsArray) {
      const pointAPositionAsDecimal: PositionAsDecimal = {
        longitude: pointA.getPosition().longitudeDegrees,
        latitude: pointA.getPosition().latitudeDegrees,
      };
      const pointBPositionAsDecimal: PositionAsDecimal = {
        longitude: pointB.getPosition().longitudeDegrees,
        latitude: pointB.getPosition().latitudeDegrees,
      };
      distance += getDistance(pointAPositionAsDecimal, pointBPositionAsDecimal, accuracyInMeters, precision);
      pointA = pointB;
    }
    return distance;
  }
}
