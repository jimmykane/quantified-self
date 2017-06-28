import * as GeoLib from 'geolib/dist/geolib';
import PositionAsDecimal = GeoLib.PositionAsDecimal;
import {DistanceAdapterInterface} from './distance.adapter.interface';
import {PointInterface} from '../../../points/point.interface';

export class DistanceVincenty implements DistanceAdapterInterface {
  getDistance(points: PointInterface[], accuracyInMeters?: number, precision?: number): number {
    const t0 = performance.now();
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
      distance += GeoLib.getDistance(pointAPositionAsDecimal, pointBPositionAsDecimal, accuracyInMeters, precision);
      pointA = pointB;
    }
    console.log('Distance Vincenty Calculated after  ' +
      (performance.now() - t0) + ' milliseconds or ' +
      (performance.now() - t0) / 1000 + ' seconds'
    );
    return distance;
  }
}
