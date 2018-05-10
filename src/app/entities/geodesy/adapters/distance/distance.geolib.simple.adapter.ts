import {DistanceAdapterInterface} from './distance.adapter.interface';
import {PointInterface} from '../../../points/point.interface';
import { getDistanceSimple, PositionAsDecimal } from 'geolib';

export class DistanceSimple implements DistanceAdapterInterface {
  getDistance(points: PointInterface[], accuracyInMeters?: number): number {
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
      const calculatedDistance = getDistanceSimple(pointAPositionAsDecimal, pointBPositionAsDecimal, accuracyInMeters);
      if (calculatedDistance) {
        distance += calculatedDistance;
      }
      pointA = pointB;
    }
    return distance;
  }
}
