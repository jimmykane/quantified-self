import * as GeoLib from 'geolib/dist/geolib';
import PositionAsDecimal = GeoLib.PositionAsDecimal;
import {DistanceAdapterInterface} from './distance.adapter.interface';
import {PointInterface} from '../../../points/point.interface';

export class DistanceSimple implements DistanceAdapterInterface {
  getDistance(points: PointInterface[]): number {
    let distance = 0;
    const excludeFirstPointsArray = points.slice(1);
    let pointA = points[0];
    for (const pointB of excludeFirstPointsArray) {
      if (!pointA.getPosition() || !pointB.getPosition()) {
        continue;
      }
      const pointAPositionAsDecimal: PositionAsDecimal = {
        longitude: pointA.getPosition().longitudeDegrees,
        latitude: pointA.getPosition().latitudeDegrees,
      };
      const pointBPositionAsDecimal: PositionAsDecimal = {
        longitude: pointB.getPosition().longitudeDegrees,
        latitude: pointB.getPosition().latitudeDegrees,
      };
      distance += GeoLib.getDistanceSimple(pointAPositionAsDecimal, pointBPositionAsDecimal);
      pointA = pointB;
    }
    return distance;
  }
}
