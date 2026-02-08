import { describe, it, expect } from 'vitest';
import { MyTracksTripDetectionService, TripDetectionInput } from './my-tracks-trip-detection.service';

const input = (eventId: string, startDate: string, latitudeDegrees: number, longitudeDegrees: number): TripDetectionInput => ({
  eventId,
  startDate,
  latitudeDegrees,
  longitudeDegrees,
});

describe('MyTracksTripDetectionService', () => {
  const service = new MyTracksTripDetectionService();

  it('detects a single qualifying trip', () => {
    const detectedTrips = service.detectTrips([
      input('a1', '2024-04-01T08:00:00Z', 27.7101, 85.3221),
      input('a2', '2024-04-03T08:00:00Z', 27.7150, 85.3300),
      input('a3', '2024-04-06T08:00:00Z', 27.7200, 85.3400),
    ]);

    expect(detectedTrips).toHaveLength(1);
    expect(detectedTrips[0].activityCount).toBe(3);
    expect(detectedTrips[0].startDate.toISOString()).toBe('2024-04-01T08:00:00.000Z');
    expect(detectedTrips[0].endDate.toISOString()).toBe('2024-04-06T08:00:00.000Z');
  });

  it('splits trips when locations are far apart', () => {
    const detectedTrips = service.detectTrips([
      input('g1', '2024-01-01T08:00:00Z', 37.9800, 23.7200),
      input('g2', '2024-01-03T08:00:00Z', 37.9700, 23.7400),
      input('g3', '2024-01-05T08:00:00Z', 37.9600, 23.7600),
      input('n1', '2024-01-06T08:00:00Z', 28.2200, 83.9900),
      input('n2', '2024-01-08T08:00:00Z', 28.2100, 84.0100),
      input('n3', '2024-01-10T08:00:00Z', 28.2000, 84.0300),
    ]);

    expect(detectedTrips).toHaveLength(2);
    expect(detectedTrips[0].tripId).toContain('g1-g3');
    expect(detectedTrips[1].tripId).toContain('n1-n3');
  });

  it('merges trips on long time gaps if location is same (consecutive trips)', () => {
    const detectedTrips = service.detectTrips([
      input('t1', '2024-02-01T08:00:00Z', 40.6401, 22.9444),
      input('t2', '2024-02-03T08:00:00Z', 40.6420, 22.9500),
      input('t3', '2024-02-05T08:00:00Z', 40.6440, 22.9550),
      // 5 days gap
      input('t4', '2024-02-10T08:00:00Z', 40.6405, 22.9449),
      input('t5', '2024-02-12T08:00:00Z', 40.6430, 22.9510),
      input('t6', '2024-02-14T08:00:00Z', 40.6450, 22.9560),
    ]);

    // Previously returned 2, now should merge into 1 because distance is negligible
    expect(detectedTrips).toHaveLength(1);
    expect(detectedTrips[0].activityCount).toBe(6);
  });

  it('rejects short or sparse segments', () => {
    const detectedTrips = service.detectTrips([
      input('s1', '2024-03-01T08:00:00Z', 37.9800, 23.7200),
      input('s2', '2024-03-02T08:00:00Z', 37.9810, 23.7250),
      input('s3', '2024-03-03T08:00:00Z', 37.9820, 23.7300),
      input('s4', '2024-03-10T08:00:00Z', 37.9830, 23.7350),
      input('s5', '2024-03-15T08:00:00Z', 37.9840, 23.7400),
    ]);

    expect(detectedTrips).toEqual([]);
  });
});
