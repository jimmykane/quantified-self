import { describe, expect, it } from 'vitest';
import {
  boundsMayBeWithinRadius,
  findNearestPointOnPolyline,
  haversineDistanceMeters,
  isValidSpatialPosition,
} from './spatial';

describe('MCP spatial helpers', () => {
  it('validates finite geographic coordinates', () => {
    expect(isValidSpatialPosition({
      latitudeDegrees: 39.665,
      longitudeDegrees: 20.8537,
    })).toBe(true);
    expect(isValidSpatialPosition({
      latitudeDegrees: 91,
      longitudeDegrees: 20,
    })).toBe(false);
    expect(isValidSpatialPosition({
      latitudeDegrees: 39,
      longitudeDegrees: Number.NaN,
    })).toBe(false);
  });

  it('calculates stable haversine distances across the antimeridian', () => {
    const distance = haversineDistanceMeters(
      { latitudeDegrees: 0, longitudeDegrees: 179.9 },
      { latitudeDegrees: 0, longitudeDegrees: -179.9 },
    );

    expect(distance).toBeGreaterThan(22_000);
    expect(distance).toBeLessThan(22_300);
  });

  it('finds the nearest interior point on a polyline segment', () => {
    const nearest = findNearestPointOnPolyline(
      { latitudeDegrees: 1, longitudeDegrees: 1 },
      [
        { latitudeDegrees: 0, longitudeDegrees: 0 },
        { latitudeDegrees: 0, longitudeDegrees: 2 },
      ],
    );

    expect(nearest?.segmentPointIndex).toBe(0);
    expect(nearest?.position.latitudeDegrees).toBeCloseTo(0, 6);
    expect(nearest?.position.longitudeDegrees).toBeCloseTo(1, 4);
    expect(nearest?.distanceMeters).toBeGreaterThan(111_000);
    expect(nearest?.distanceMeters).toBeLessThan(111_300);
  });

  it('uses the nearest endpoint when the projected point is outside the segment', () => {
    const nearest = findNearestPointOnPolyline(
      { latitudeDegrees: 0, longitudeDegrees: 3 },
      [
        { latitudeDegrees: 0, longitudeDegrees: 0 },
        { latitudeDegrees: 0, longitudeDegrees: 2 },
      ],
    );

    expect(nearest?.position).toEqual({
      latitudeDegrees: 0,
      longitudeDegrees: 2,
    });
  });

  it('finds points on route segments that cross the antimeridian', () => {
    const nearest = findNearestPointOnPolyline(
      { latitudeDegrees: 0.1, longitudeDegrees: 180 },
      [
        { latitudeDegrees: 0, longitudeDegrees: 179.5 },
        { latitudeDegrees: 0, longitudeDegrees: -179.5 },
      ],
    );

    expect(nearest?.position.latitudeDegrees).toBeCloseTo(0, 5);
    expect(Math.abs(nearest?.position.longitudeDegrees || 0)).toBeCloseTo(180, 5);
    expect(nearest?.distanceMeters).toBeLessThan(11_200);
  });

  it('conservatively rejects distant bounds and accepts nearby or wrapped candidates', () => {
    const ioannina = {
      latitudeDegrees: 39.665,
      longitudeDegrees: 20.8537,
    };
    expect(boundsMayBeWithinRadius(ioannina, {
      minLatitudeDegrees: 39.6,
      maxLatitudeDegrees: 39.8,
      minLongitudeDegrees: 20.7,
      maxLongitudeDegrees: 20.9,
    }, 1_000)).toBe(true);
    expect(boundsMayBeWithinRadius(ioannina, {
      minLatitudeDegrees: 40.6,
      maxLatitudeDegrees: 40.8,
      minLongitudeDegrees: 22.7,
      maxLongitudeDegrees: 22.9,
    }, 25_000)).toBe(false);
    expect(boundsMayBeWithinRadius({
      latitudeDegrees: 0,
      longitudeDegrees: 179.9,
    }, {
      minLatitudeDegrees: -1,
      maxLatitudeDegrees: 1,
      minLongitudeDegrees: -179.95,
      maxLongitudeDegrees: -179.8,
    }, 50_000)).toBe(true);
  });
});
