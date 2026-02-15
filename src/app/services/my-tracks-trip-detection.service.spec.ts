import { describe, expect, it } from 'vitest';
import { MyTracksTripDetectionService, TripDetectionInput } from './my-tracks-trip-detection.service';

const input = (eventId: string, startDate: string, latitudeDegrees: number, longitudeDegrees: number): TripDetectionInput => ({
  eventId,
  startDate,
  latitudeDegrees,
  longitudeDegrees,
});

describe('MyTracksTripDetectionService', () => {
  const service = new MyTracksTripDetectionService();

  it('detects non-consecutive revisits with same destination id (A-B-A)', () => {
    const detectedTrips = service.detectTrips([
      input('a1', '2024-01-01T08:00:00Z', 37.9800, 23.7200),
      input('a2', '2024-01-02T09:00:00Z', 37.9810, 23.7210),
      input('a3', '2024-01-03T10:00:00Z', 37.9790, 23.7190),
      input('a4', '2024-01-04T11:00:00Z', 37.9820, 23.7230),
      input('b1', '2024-01-06T08:00:00Z', 28.2200, 83.9900),
      input('b2', '2024-01-07T09:00:00Z', 28.2300, 84.0000),
      input('c1', '2024-01-08T08:00:00Z', 40.6401, 22.9444),
      input('c2', '2024-01-09T09:00:00Z', 40.6420, 22.9500),
      input('a5', '2024-01-15T08:00:00Z', 37.9780, 23.7180),
      input('a6', '2024-01-16T09:00:00Z', 37.9770, 23.7170),
      input('a7', '2024-01-17T10:00:00Z', 37.9790, 23.7190),
      input('a8', '2024-01-18T11:00:00Z', 37.9800, 23.7200),
    ]);

    const athensTrips = detectedTrips
      .filter((trip) => Math.abs(trip.centroidLat - 37.98) < 0.2 && Math.abs(trip.centroidLng - 23.72) < 0.2)
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());

    expect(athensTrips).toHaveLength(2);
    expect(athensTrips[0].destinationId).toBe(athensTrips[1].destinationId);
    expect(athensTrips[0].destinationVisitIndex).toBe(1);
    expect(athensTrips[1].destinationVisitIndex).toBe(2);
    expect(athensTrips[0].destinationVisitCount).toBe(2);
    expect(athensTrips[1].destinationVisitCount).toBe(2);
    expect(athensTrips[0].isRevisit).toBe(false);
    expect(athensTrips[1].isRevisit).toBe(true);
  });

  it('rejoins same-destination visits when gap is short and no destination is in between', () => {
    const detectedTrips = service.detectTrips([
      input('it-1', '2025-05-07T06:00:00Z', 41.9028, 12.4964),
      input('it-2', '2025-05-08T06:00:00Z', 41.9010, 12.4990),
      input('it-3', '2025-05-10T06:00:00Z', 41.9050, 12.4940),
      input('it-4', '2025-05-11T06:00:00Z', 41.9000, 12.4920),
      input('it-5', '2025-05-14T10:00:00Z', 41.9040, 12.4950),
      input('it-6', '2025-05-16T10:00:00Z', 41.9060, 12.4980),
      input('it-7', '2025-05-18T10:00:00Z', 41.9030, 12.4930),
      input('it-8', '2025-05-21T10:00:00Z', 41.9020, 12.4970),
    ]);

    expect(detectedTrips).toHaveLength(1);
    expect(detectedTrips[0].activityCount).toBe(8);
    expect(detectedTrips[0].destinationVisitCount).toBe(1);
    expect(detectedTrips[0].isRevisit).toBe(false);
    expect(detectedTrips[0].startDate.toISOString()).toBe('2025-05-07T06:00:00.000Z');
    expect(detectedTrips[0].endDate.toISOString()).toBe('2025-05-21T10:00:00.000Z');
  });

  it('keeps A-B-C as separate destinations', () => {
    const detectedTrips = service.detectTrips([
      input('a1', '2024-02-01T08:00:00Z', 37.9800, 23.7200),
      input('a2', '2024-02-02T09:00:00Z', 37.9810, 23.7210),
      input('b1', '2024-02-03T08:00:00Z', 28.2200, 83.9900),
      input('b2', '2024-02-04T09:00:00Z', 28.2300, 84.0000),
      input('c1', '2024-02-05T08:00:00Z', 40.6401, 22.9444),
      input('c2', '2024-02-06T09:00:00Z', 40.6420, 22.9500),
    ]);

    expect(detectedTrips).toHaveLength(3);
    expect(new Set(detectedTrips.map((trip) => trip.destinationId)).size).toBe(3);
  });

  it('does not rejoin same-destination visits when another destination is in between and same-destination gap is short', () => {
    const detectedTrips = service.detectTrips([
      input('a-1', '2025-04-01T08:00:00Z', 37.9800, 23.7200),
      input('a-2', '2025-04-02T08:00:00Z', 37.9810, 23.7210),
      input('a-3', '2025-04-03T08:00:00Z', 37.9820, 23.7220),
      input('a-4', '2025-04-04T08:00:00Z', 37.9830, 23.7230),
      input('b-1', '2025-04-05T08:00:00Z', 28.2200, 83.9900),
      input('b-2', '2025-04-06T10:00:00Z', 28.2300, 84.0000),
      input('a-5', '2025-04-06T20:00:00Z', 37.9840, 23.7240),
      input('a-6', '2025-04-07T20:00:00Z', 37.9850, 23.7250),
      input('a-7', '2025-04-08T20:00:00Z', 37.9860, 23.7260),
      input('a-8', '2025-04-09T20:00:00Z', 37.9870, 23.7270),
    ]);

    const athensTrips = detectedTrips
      .filter((trip) => Math.abs(trip.centroidLat - 37.9835) < 0.5 && Math.abs(trip.centroidLng - 23.7235) < 0.5)
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime());

    expect(athensTrips).toHaveLength(2);
    expect(athensTrips[0].destinationId).toBe(athensTrips[1].destinationId);
    expect(athensTrips[0].destinationVisitCount).toBe(2);
    expect(athensTrips[1].destinationVisitCount).toBe(2);
    expect(athensTrips[1].isRevisit).toBe(true);
  });

  it('splits visits for the same destination on large time gaps', () => {
    const detectedTrips = service.detectTrips([
      input('d1', '2024-03-01T08:00:00Z', 39.9200, 32.8500),
      input('d2', '2024-03-02T08:00:00Z', 39.9210, 32.8510),
      input('d3', '2024-03-03T08:00:00Z', 39.9220, 32.8520),
      input('d4', '2024-03-04T08:00:00Z', 39.9230, 32.8530),
      input('d5', '2024-03-12T08:00:00Z', 39.9240, 32.8540),
      input('d6', '2024-03-13T08:00:00Z', 39.9250, 32.8550),
      input('d7', '2024-03-14T08:00:00Z', 39.9260, 32.8560),
      input('d8', '2024-03-15T08:00:00Z', 39.9270, 32.8570),
    ]);

    expect(detectedTrips).toHaveLength(2);
    expect(detectedTrips[0].destinationId).toBe(detectedTrips[1].destinationId);
    expect(detectedTrips[0].destinationVisitIndex).toBe(1);
    expect(detectedTrips[1].destinationVisitIndex).toBe(2);
  });

  it('rejects short home-cluster windows as local noise', () => {
    const detectedTrips = service.detectTrips([
      input('h1', '2024-04-01T08:00:00Z', 37.9800, 23.7200),
      input('h2', '2024-04-01T12:00:00Z', 37.9810, 23.7210),
      input('h3', '2024-04-01T16:00:00Z', 37.9820, 23.7220),
      input('h4', '2024-04-02T08:00:00Z', 37.9800, 23.7200),
      input('h5', '2024-04-02T12:00:00Z', 37.9810, 23.7210),
      input('h6', '2024-04-02T16:00:00Z', 37.9820, 23.7220),
    ]);

    expect(detectedTrips).toEqual([]);
  });

  it('keeps small remote trips when only home windows are suppressed', () => {
    const detectedTrips = service.detectTrips([
      input('home-1', '2024-05-01T08:00:00Z', 37.9800, 23.7200),
      input('home-2', '2024-05-01T12:00:00Z', 37.9810, 23.7210),
      input('home-3', '2024-05-01T16:00:00Z', 37.9820, 23.7220),
      input('home-4', '2024-05-02T08:00:00Z', 37.9800, 23.7200),
      input('remote-1', '2024-05-03T08:00:00Z', 28.2200, 83.9900),
      input('remote-2', '2024-05-04T09:00:00Z', 28.2300, 84.0000),
    ]);

    expect(detectedTrips).toHaveLength(1);
    expect(detectedTrips[0].activityCount).toBe(2);
    expect(Math.abs(detectedTrips[0].centroidLat - 28.225)).toBeLessThan(0.2);
    expect(Math.abs(detectedTrips[0].centroidLng - 83.995)).toBeLessThan(0.2);
  });

  it('returns deterministic trip IDs regardless of input order', () => {
    const dataset = [
      input('x1', '2024-06-01T08:00:00Z', 37.9800, 23.7200),
      input('x2', '2024-06-02T09:00:00Z', 37.9810, 23.7210),
      input('y1', '2024-06-03T08:00:00Z', 28.2200, 83.9900),
      input('y2', '2024-06-04T09:00:00Z', 28.2300, 84.0000),
      input('z1', '2024-06-05T08:00:00Z', 40.6401, 22.9444),
      input('z2', '2024-06-06T09:00:00Z', 40.6420, 22.9500),
    ];

    const forwardTrips = service.detectTrips(dataset).map((trip) => trip.tripId);
    const reversedTrips = service.detectTrips([...dataset].reverse()).map((trip) => trip.tripId);

    expect(reversedTrips).toEqual(forwardTrips);
  });
});
