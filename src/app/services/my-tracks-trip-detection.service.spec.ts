import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DetectedHomeArea,
  MyTracksTripDetectionService,
  TripDetectionInput,
  TripDetectionOptions,
} from './my-tracks-trip-detection.service';
import { LoggerService } from './logger.service';

const input = (eventId: string, startDate: string, latitudeDegrees: number, longitudeDegrees: number): TripDetectionInput => ({
  eventId,
  startDate,
  latitudeDegrees,
  longitudeDegrees,
});

const homeHistory = (...prefixes: string[]): TripDetectionOptions => ({
  homeInferenceInputs: prefixes.flatMap((prefix, index) => ([
    input(`${prefix}-1`, `2023-12-${String(index * 5 + 1).padStart(2, '0')}T06:00:00Z`, 37.9800, 23.7200),
    input(`${prefix}-2`, `2023-12-${String(index * 5 + 2).padStart(2, '0')}T06:00:00Z`, 37.9810, 23.7210),
    input(`${prefix}-3`, `2023-12-${String(index * 5 + 3).padStart(2, '0')}T06:00:00Z`, 37.9820, 23.7220),
    input(`${prefix}-4`, `2023-12-${String(index * 5 + 4).padStart(2, '0')}T06:00:00Z`, 37.9830, 23.7230),
    input(`${prefix}-5`, `2023-12-${String(index * 5 + 5).padStart(2, '0')}T06:00:00Z`, 37.9840, 23.7240),
  ])),
});

const remoteHomeHistory = (...prefixes: string[]): TripDetectionOptions => ({
  homeInferenceInputs: prefixes.flatMap((prefix, index) => ([
    input(`${prefix}-1`, `2023-11-${String(index * 5 + 1).padStart(2, '0')}T06:00:00Z`, 51.5074, -0.1278),
    input(`${prefix}-2`, `2023-11-${String(index * 5 + 2).padStart(2, '0')}T06:00:00Z`, 51.5084, -0.1268),
    input(`${prefix}-3`, `2023-11-${String(index * 5 + 3).padStart(2, '0')}T06:00:00Z`, 51.5094, -0.1258),
    input(`${prefix}-4`, `2023-11-${String(index * 5 + 4).padStart(2, '0')}T06:00:00Z`, 51.5104, -0.1248),
    input(`${prefix}-5`, `2023-11-${String(index * 5 + 5).padStart(2, '0')}T06:00:00Z`, 51.5114, -0.1238),
  ])),
});

describe('MyTracksTripDetectionService', () => {
  const logger = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as LoggerService;
  const service = new MyTracksTripDetectionService(logger);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects non-consecutive revisits with same destination id (A-B-A) when home is inferred elsewhere', () => {
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
    ], remoteHomeHistory('home-a', 'home-b'));

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

  it('returns a single qualified trip when broader history identifies home elsewhere', () => {
    const detectedTrips = service.detectTrips([
      input('rome-1', '2024-05-07T06:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-05-08T06:00:00Z', 41.9010, 12.4990),
      input('rome-3', '2024-05-09T06:00:00Z', 41.9050, 12.4940),
      input('rome-4', '2024-05-10T06:00:00Z', 41.9000, 12.4920),
    ], homeHistory('home'));

    expect(detectedTrips).toHaveLength(1);
    expect(detectedTrips[0].activityCount).toBe(4);
  });

  it('suppresses matched home windows even when they satisfy duration and activity thresholds', () => {
    const detectionResult = service.detectTripsWithContext([
      input('home-1', '2024-06-01T08:00:00Z', 37.9800, 23.7200),
      input('home-2', '2024-06-02T09:00:00Z', 37.9810, 23.7210),
      input('home-3', '2024-06-03T10:00:00Z', 37.9820, 23.7220),
      input('home-4', '2024-06-04T11:00:00Z', 37.9830, 23.7230),
      input('rome-1', '2024-06-06T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-06-07T09:00:00Z', 41.9010, 12.4990),
    ], homeHistory('home-a', 'home-b'));

    expect(detectionResult.trips).toHaveLength(1);
    expect(detectionResult.trips[0].destinationId).not.toBe(detectionResult.homeArea?.destinationId);
    expect(detectionResult.homeArea).not.toBeNull();
  });

  it('suppresses multiple local clusters around home instead of surfacing them as trips', () => {
    const detectionResult = service.detectTripsWithContext([
      input('local-west-1', '2024-06-01T08:00:00Z', 37.9800, 23.3000),
      input('local-west-2', '2024-06-02T09:00:00Z', 37.9810, 23.3010),
      input('local-east-1', '2024-06-03T08:00:00Z', 37.9800, 24.1400),
      input('local-east-2', '2024-06-04T09:00:00Z', 37.9810, 24.1410),
      input('rome-1', '2024-06-06T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-06-07T09:00:00Z', 41.9010, 12.4990),
    ], homeHistory('home-a', 'home-b'));

    expect(detectionResult.trips).toHaveLength(1);
    expect(detectionResult.trips[0].eventIds).toEqual(['rome-1', 'rome-2']);
    expect(detectionResult.homeArea).toEqual(expect.objectContaining({
      pointCount: 4,
      destinationId: expect.any(String),
    }));
  });

  it('treats current clusters within the wider home suppression radius as home', () => {
    const detectionResult = service.detectTripsWithContext([
      input('home-edge-1', '2024-06-01T08:00:00Z', 37.9800, 24.3000),
      input('home-edge-2', '2024-06-02T09:00:00Z', 37.9810, 24.3010),
      input('rome-1', '2024-06-06T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-06-07T09:00:00Z', 41.9010, 12.4990),
    ], homeHistory('home-a', 'home-b'));

    expect(detectionResult.trips).toHaveLength(1);
    expect(detectionResult.trips[0].eventIds).toEqual(['rome-1', 'rome-2']);
    expect(detectionResult.homeArea).not.toBeNull();
    expect(detectionResult.homeArea?.pointCount).toBe(2);
  });

  it('does not suppress a dominant current-range trip when history-derived home does not match a current destination', () => {
    const detectedTrips = service.detectTrips([
      input('rome-1', '2024-05-07T06:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-05-08T06:00:00Z', 41.9010, 12.4990),
      input('rome-3', '2024-05-09T06:00:00Z', 41.9050, 12.4940),
      input('rome-4', '2024-05-10T06:00:00Z', 41.9000, 12.4920),
      input('paris-1', '2024-05-12T06:00:00Z', 48.8566, 2.3522),
      input('paris-2', '2024-05-13T06:00:00Z', 48.8576, 2.3532),
    ], homeHistory('home'));

    expect(detectedTrips).toHaveLength(2);
    expect(detectedTrips.filter((trip) => Math.abs(trip.centroidLat - 41.903) < 0.2)).toHaveLength(1);
  });

  it('does not warn about missing destination assignments for isolated home-inference noise points', () => {
    service.detectTripsWithContext(
      [
        input('rome-1', '2024-06-06T08:00:00Z', 41.9028, 12.4964),
        input('rome-2', '2024-06-07T09:00:00Z', 41.9010, 12.4990),
      ],
      {
        homeInferenceInputs: [
          input('home-1', '2024-01-01T08:00:00Z', 37.9800, 23.7200),
          input('home-2', '2024-01-10T08:00:00Z', 37.9810, 23.7210),
          input('home-3', '2024-02-01T08:00:00Z', 37.9820, 23.7220),
          input('home-4', '2024-02-10T08:00:00Z', 37.9830, 23.7230),
          input('isolated-noise', '2025-11-16T07:04:23Z', 52.5200, 13.4050),
        ],
      },
    );

    expect((logger.warn as any).mock.calls).not.toEqual(
      expect.arrayContaining([
        [
          '[MyTracksTripDetectionService] Missing destination assignment for timeline point.',
          expect.anything(),
        ],
      ]),
    );
  });

  it('keeps 90km-apart destinations separate', () => {
    const detectedTrips = service.detectTrips([
      input('a1', '2024-02-01T08:00:00Z', 0.0000, 0.0000),
      input('a2', '2024-02-02T08:00:00Z', 0.0000, 0.0100),
      input('b1', '2024-02-03T08:00:00Z', 0.0000, 0.8000),
      input('b2', '2024-02-04T08:00:00Z', 0.0000, 0.8100),
      input('c1', '2024-02-05T08:00:00Z', 0.0000, 1.6000),
      input('c2', '2024-02-06T08:00:00Z', 0.0000, 1.6100),
    ]);

    expect(detectedTrips).toHaveLength(3);
    expect(new Set(detectedTrips.map((trip) => trip.destinationId)).size).toBe(3);
  });

  it('rejoins nearby same-destination windows when the gap stays within four days', () => {
    const detectedTrips = service.detectTrips([
      input('rome-1', '2024-03-01T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-03-02T08:00:00Z', 41.9010, 12.4990),
      input('rome-3', '2024-03-05T20:00:00Z', 41.9050, 12.4940),
      input('rome-4', '2024-03-06T20:00:00Z', 41.9000, 12.4920),
    ], homeHistory('home'));

    expect(detectedTrips).toHaveLength(1);
    expect(detectedTrips[0].activityCount).toBe(4);
  });

  it('splits same-destination visits when the gap exceeds four days', () => {
    const detectedTrips = service.detectTrips([
      input('rome-1', '2024-03-01T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-03-02T08:00:00Z', 41.9010, 12.4990),
      input('rome-3', '2024-03-06T20:30:00Z', 41.9050, 12.4940),
      input('rome-4', '2024-03-07T20:30:00Z', 41.9000, 12.4920),
    ], homeHistory('home'));

    expect(detectedTrips).toHaveLength(2);
    expect(detectedTrips[0].destinationId).toBe(detectedTrips[1].destinationId);
    expect(detectedTrips[0].destinationVisitIndex).toBe(1);
    expect(detectedTrips[1].destinationVisitIndex).toBe(2);
  });

  it('does not rejoin same-destination trips across a suppressed home window', () => {
    const detectedTrips = service.detectTrips([
      input('remote-1', '2024-01-10T08:00:00Z', 41.9028, 12.4964),
      input('remote-2', '2024-01-11T08:00:00Z', 41.9010, 12.4990),
      input('home-1', '2024-01-12T08:00:00Z', 37.9800, 23.7200),
      input('home-2', '2024-01-12T12:00:00Z', 37.9810, 23.7210),
      input('home-3', '2024-01-13T08:00:00Z', 37.9820, 23.7220),
      input('home-4', '2024-01-13T12:00:00Z', 37.9830, 23.7230),
      input('remote-3', '2024-01-14T08:00:00Z', 41.9050, 12.4940),
      input('remote-4', '2024-01-15T08:00:00Z', 41.9000, 12.4920),
    ], homeHistory('home-a', 'home-b'));

    const remoteTrips = detectedTrips.filter((trip) => Math.abs(trip.centroidLat - 41.902) < 0.2);
    expect(remoteTrips).toHaveLength(2);
    expect(remoteTrips[0].destinationId).toBe(remoteTrips[1].destinationId);
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

  it('exposes the matched current home area when one home cluster is present in the current range', () => {
    const detectionResult = service.detectTripsWithContext([
      input('home-1', '2024-06-01T08:00:00Z', 37.9800, 23.7200),
      input('home-2', '2024-06-02T09:00:00Z', 37.9810, 23.7210),
      input('home-3', '2024-06-03T10:00:00Z', 37.9820, 23.7220),
      input('home-4', '2024-06-04T11:00:00Z', 37.9830, 23.7230),
      input('rome-1', '2024-06-06T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-06-07T09:00:00Z', 41.9010, 12.4990),
    ], homeHistory('home-a', 'home-b'));

    expect(detectionResult.trips).toHaveLength(1);
    expect(detectionResult.trips[0].eventIds).toEqual(['rome-1', 'rome-2']);
    expect(detectionResult.homeArea).toEqual<DetectedHomeArea>(expect.objectContaining({
      destinationId: expect.any(String),
      pointCount: 4,
      pointShare: expect.any(Number),
      centroidLat: expect.closeTo(37.9815, 4),
      centroidLng: expect.closeTo(23.7215, 4),
      bounds: {
        west: 23.7200,
        east: 23.7230,
        south: 37.9800,
        north: 37.9830,
      },
      radiusKm: expect.any(Number),
    }));
    expect(detectionResult.homeArea?.radiusKm).toBeGreaterThanOrEqual(2.5);
  });

  it('does not expose a home area when the inferred home cluster is absent from the current range', () => {
    const detectionResult = service.detectTripsWithContext([
      input('rome-1', '2024-06-06T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2024-06-07T09:00:00Z', 41.9010, 12.4990),
      input('rome-3', '2024-06-08T10:00:00Z', 41.9050, 12.4940),
      input('rome-4', '2024-06-09T11:00:00Z', 41.9000, 12.4920),
    ], homeHistory('home-a', 'home-b'));

    expect(detectionResult.trips).toHaveLength(1);
    expect(detectionResult.homeArea).toBeNull();
  });

  it('infers recurrent home clusters even when point share drops below fifty percent', () => {
    const detectionResult = service.detectTripsWithContext([
      input('io-1', '2025-01-03T08:00:00Z', 39.6790, 20.8780),
      input('io-2', '2025-01-04T08:00:00Z', 39.6800, 20.8790),
      input('io-3', '2025-03-03T08:00:00Z', 39.6780, 20.8770),
      input('io-4', '2025-03-04T08:00:00Z', 39.6795, 20.8785),
      input('io-5', '2025-05-03T08:00:00Z', 39.6792, 20.8778),
      input('io-6', '2025-05-04T08:00:00Z', 39.6802, 20.8788),
      input('io-7', '2025-07-03T08:00:00Z', 39.6788, 20.8776),
      input('io-8', '2025-07-04T08:00:00Z', 39.6798, 20.8786),
      input('bor-1', '2025-08-10T08:00:00Z', 42.2560, 23.6060),
      input('bor-2', '2025-08-11T08:00:00Z', 42.2570, 23.6070),
      input('bor-3', '2025-08-12T08:00:00Z', 42.2580, 23.6080),
      input('bor-4', '2025-08-13T08:00:00Z', 42.2590, 23.6090),
      input('bor-5', '2025-08-14T08:00:00Z', 42.2600, 23.6100),
      input('bor-6', '2025-08-15T08:00:00Z', 42.2610, 23.6110),
      input('bor-7', '2025-08-16T08:00:00Z', 42.2620, 23.6120),
      input('bor-8', '2025-08-17T08:00:00Z', 42.2630, 23.6130),
      input('bor-9', '2025-08-18T08:00:00Z', 42.2640, 23.6140),
      input('bor-10', '2025-08-19T08:00:00Z', 42.2650, 23.6150),
      input('ano-1', '2025-06-07T08:00:00Z', 38.5410, 21.9460),
      input('ano-2', '2025-06-08T08:00:00Z', 38.5420, 21.9470),
      input('ano-3', '2025-07-10T08:00:00Z', 38.5430, 21.9480),
      input('ano-4', '2025-07-11T08:00:00Z', 38.5440, 21.9490),
    ]);

    expect(detectionResult.homeArea).toEqual(expect.objectContaining({
      destinationId: expect.stringContaining('39.679'),
      pointCount: 8,
    }));
    expect(detectionResult.trips.some((trip) => trip.destinationId === detectionResult.homeArea?.destinationId)).toBe(false);
  });

  it('does not infer home from a sub-fifty-percent cluster when it lacks recurrence across time', () => {
    const detectionResult = service.detectTripsWithContext([
      input('rome-1', '2025-05-01T08:00:00Z', 41.9028, 12.4964),
      input('rome-2', '2025-05-02T08:00:00Z', 41.9038, 12.4974),
      input('rome-3', '2025-05-03T08:00:00Z', 41.9048, 12.4984),
      input('rome-4', '2025-05-04T08:00:00Z', 41.9058, 12.4994),
      input('rome-5', '2025-05-05T08:00:00Z', 41.9068, 12.5004),
      input('athens-1', '2025-06-01T08:00:00Z', 37.9800, 23.7200),
      input('athens-2', '2025-06-02T08:00:00Z', 37.9810, 23.7210),
      input('athens-3', '2025-06-03T08:00:00Z', 37.9820, 23.7220),
      input('athens-4', '2025-06-04T08:00:00Z', 37.9830, 23.7230),
      input('thess-1', '2025-07-01T08:00:00Z', 40.6401, 22.9444),
      input('thess-2', '2025-07-02T08:00:00Z', 40.6420, 22.9500),
    ]);

    expect(detectionResult.homeArea).toBeNull();
  });
});
