const EARTH_RADIUS_METERS = 6_371_000;
const MINIMUM_COSINE = 1e-6;

export interface SpatialPosition {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface SpatialBounds {
  minLatitudeDegrees: number;
  maxLatitudeDegrees: number;
  minLongitudeDegrees: number;
  maxLongitudeDegrees: number;
}

export interface NearestPolylinePoint {
  distanceMeters: number;
  position: SpatialPosition;
  segmentPointIndex: number;
}

export function isValidSpatialPosition(value: unknown): value is SpatialPosition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.latitudeDegrees === 'number'
    && Number.isFinite(candidate.latitudeDegrees)
    && Math.abs(candidate.latitudeDegrees) <= 90
    && typeof candidate.longitudeDegrees === 'number'
    && Number.isFinite(candidate.longitudeDegrees)
    && Math.abs(candidate.longitudeDegrees) <= 180;
}

export function haversineDistanceMeters(
  first: SpatialPosition,
  second: SpatialPosition,
): number {
  const firstLatitude = toRadians(first.latitudeDegrees);
  const secondLatitude = toRadians(second.latitudeDegrees);
  const deltaLatitude = secondLatitude - firstLatitude;
  const deltaLongitude = toRadians(normalizeLongitudeDeltaDegrees(
    second.longitudeDegrees - first.longitudeDegrees,
  ));
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(firstLatitude)
    * Math.cos(secondLatitude)
    * Math.sin(deltaLongitude / 2) ** 2;
  const angularDistance = 2 * Math.atan2(
    Math.sqrt(Math.max(0, haversine)),
    Math.sqrt(Math.max(0, 1 - haversine)),
  );
  return EARTH_RADIUS_METERS * angularDistance;
}

export function boundsMayBeWithinRadius(
  position: SpatialPosition,
  bounds: SpatialBounds,
  radiusMeters: number,
): boolean {
  if (
    !isValidSpatialPosition(position)
    || !isValidSpatialBounds(bounds)
    || !Number.isFinite(radiusMeters)
    || radiusMeters < 0
  ) {
    return false;
  }

  const latitudePadding = toDegrees(radiusMeters / EARTH_RADIUS_METERS);
  if (
    position.latitudeDegrees < bounds.minLatitudeDegrees - latitudePadding
    || position.latitudeDegrees > bounds.maxLatitudeDegrees + latitudePadding
  ) {
    return false;
  }

  const maximumAbsoluteLatitude = Math.min(
    89.999999,
    Math.max(
      Math.abs(position.latitudeDegrees),
      Math.abs(bounds.minLatitudeDegrees),
      Math.abs(bounds.maxLatitudeDegrees),
    ),
  );
  const longitudePadding = Math.min(
    180,
    latitudePadding / Math.max(
      MINIMUM_COSINE,
      Math.cos(toRadians(maximumAbsoluteLatitude)),
    ),
  );
  const minimumLongitude = bounds.minLongitudeDegrees - longitudePadding;
  const maximumLongitude = bounds.maxLongitudeDegrees + longitudePadding;
  if (maximumLongitude - minimumLongitude >= 360) {
    return true;
  }

  return [
    position.longitudeDegrees - 360,
    position.longitudeDegrees,
    position.longitudeDegrees + 360,
  ].some(longitude => (
    longitude >= minimumLongitude && longitude <= maximumLongitude
  ));
}

export function findNearestPointOnPolyline(
  position: SpatialPosition,
  rawPoints: readonly SpatialPosition[],
): NearestPolylinePoint | null {
  if (
    !isValidSpatialPosition(position)
    || rawPoints.some(point => !isValidSpatialPosition(point))
  ) {
    return null;
  }
  const points = [...rawPoints];
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return {
      distanceMeters: haversineDistanceMeters(position, points[0]),
      position: points[0],
      segmentPointIndex: 0,
    };
  }

  let nearest: NearestPolylinePoint | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const candidate = nearestPointOnGreatCircleSegment(
      position,
      points[index],
      points[index + 1],
    );
    if (!nearest || candidate.distanceMeters < nearest.distanceMeters) {
      nearest = {
        ...candidate,
        segmentPointIndex: index,
      };
    }
  }
  return nearest;
}

function isValidSpatialBounds(bounds: SpatialBounds): boolean {
  return Number.isFinite(bounds.minLatitudeDegrees)
    && Number.isFinite(bounds.maxLatitudeDegrees)
    && Number.isFinite(bounds.minLongitudeDegrees)
    && Number.isFinite(bounds.maxLongitudeDegrees)
    && bounds.minLatitudeDegrees >= -90
    && bounds.maxLatitudeDegrees <= 90
    && bounds.minLongitudeDegrees >= -180
    && bounds.maxLongitudeDegrees <= 180
    && bounds.minLatitudeDegrees <= bounds.maxLatitudeDegrees
    && bounds.minLongitudeDegrees <= bounds.maxLongitudeDegrees;
}

function nearestPointOnGreatCircleSegment(
  point: SpatialPosition,
  start: SpatialPosition,
  end: SpatialPosition,
): Omit<NearestPolylinePoint, 'segmentPointIndex'> {
  const segmentAngularDistance = angularDistance(start, end);
  if (segmentAngularDistance <= Number.EPSILON) {
    return {
      distanceMeters: haversineDistanceMeters(point, start),
      position: start,
    };
  }

  const startToPointAngularDistance = angularDistance(start, point);
  const segmentBearing = initialBearingRadians(start, end);
  const pointBearing = initialBearingRadians(start, point);
  const bearingDelta = pointBearing - segmentBearing;
  const alongTrackAngularDistance = Math.atan2(
    Math.sin(startToPointAngularDistance) * Math.cos(bearingDelta),
    Math.cos(startToPointAngularDistance),
  );

  if (alongTrackAngularDistance <= 0) {
    return {
      distanceMeters: haversineDistanceMeters(point, start),
      position: start,
    };
  }
  if (alongTrackAngularDistance >= segmentAngularDistance) {
    return {
      distanceMeters: haversineDistanceMeters(point, end),
      position: end,
    };
  }

  const nearestPosition = destinationPoint(
    start,
    segmentBearing,
    alongTrackAngularDistance,
  );
  return {
    distanceMeters: haversineDistanceMeters(point, nearestPosition),
    position: nearestPosition,
  };
}

function angularDistance(first: SpatialPosition, second: SpatialPosition): number {
  return haversineDistanceMeters(first, second) / EARTH_RADIUS_METERS;
}

function initialBearingRadians(
  start: SpatialPosition,
  end: SpatialPosition,
): number {
  const startLatitude = toRadians(start.latitudeDegrees);
  const endLatitude = toRadians(end.latitudeDegrees);
  const deltaLongitude = toRadians(normalizeLongitudeDeltaDegrees(
    end.longitudeDegrees - start.longitudeDegrees,
  ));
  return Math.atan2(
    Math.sin(deltaLongitude) * Math.cos(endLatitude),
    Math.cos(startLatitude) * Math.sin(endLatitude)
      - Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(deltaLongitude),
  );
}

function destinationPoint(
  start: SpatialPosition,
  bearingRadians: number,
  angularDistanceRadians: number,
): SpatialPosition {
  const startLatitude = toRadians(start.latitudeDegrees);
  const startLongitude = toRadians(start.longitudeDegrees);
  const destinationLatitude = Math.asin(clamp(
    Math.sin(startLatitude) * Math.cos(angularDistanceRadians)
      + Math.cos(startLatitude)
      * Math.sin(angularDistanceRadians)
      * Math.cos(bearingRadians),
    -1,
    1,
  ));
  const destinationLongitude = startLongitude + Math.atan2(
    Math.sin(bearingRadians)
      * Math.sin(angularDistanceRadians)
      * Math.cos(startLatitude),
    Math.cos(angularDistanceRadians)
      - Math.sin(startLatitude) * Math.sin(destinationLatitude),
  );
  return {
    latitudeDegrees: clamp(toDegrees(destinationLatitude), -90, 90),
    longitudeDegrees: normalizeLongitudeDegrees(toDegrees(destinationLongitude)),
  };
}

function normalizeLongitudeDeltaDegrees(value: number): number {
  return ((value + 540) % 360) - 180;
}

function normalizeLongitudeDegrees(value: number): number {
  const normalized = ((value + 540) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

function toDegrees(value: number): number {
  return value * (180 / Math.PI);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
