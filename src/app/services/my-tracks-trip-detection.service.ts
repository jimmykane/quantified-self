import { Injectable } from '@angular/core';
import { LoggerService } from './logger.service';

export interface TripDetectionInput {
  eventId: string;
  startDate: Date | number | string | undefined;
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface DetectedTrip {
  tripId: string;
  startDate: Date;
  endDate: Date;
  activityCount: number;
  centroidLat: number;
  centroidLng: number;
  bounds: {
    west: number;
    east: number;
    south: number;
    north: number;
  };
}

interface NormalizedActivityStart {
  eventId: string;
  timestamp: number;
  latitudeDegrees: number;
  longitudeDegrees: number;
}

interface NormalizationResult {
  entries: NormalizedActivityStart[];
  droppedMissingEventId: number;
  droppedInvalidTimestamp: number;
  droppedInvalidCoordinates: number;
}

@Injectable({
  providedIn: 'root'
})
export class MyTracksTripDetectionService {
  private static readonly MAX_GAP_MS = 72 * 60 * 60 * 1000;
  private static readonly MAX_DISTANCE_KM = 180;
  private static readonly MIN_DURATION_MS = 4 * 24 * 60 * 60 * 1000;
  private static readonly MIN_ACTIVITY_COUNT = 3;

  constructor(
    private logger: LoggerService = new LoggerService(),
  ) { }

  public detectTrips(inputs: TripDetectionInput[]): DetectedTrip[] {
    if (!inputs || inputs.length === 0) {
      this.logger.log('[MyTracksTripDetectionService] No inputs provided for trip detection.');
      return [];
    }

    const normalizationResult = this.normalize(inputs);
    const normalized = normalizationResult.entries;

    this.logger.log('[MyTracksTripDetectionService] Normalized detection inputs.', {
      inputCount: inputs.length,
      normalizedCount: normalized.length,
      droppedMissingEventId: normalizationResult.droppedMissingEventId,
      droppedInvalidTimestamp: normalizationResult.droppedInvalidTimestamp,
      droppedInvalidCoordinates: normalizationResult.droppedInvalidCoordinates,
    });

    if (normalized.length === 0) {
      this.logger.warn('[MyTracksTripDetectionService] No valid points remain after normalization.');
      return [];
    }

    const segments: NormalizedActivityStart[][] = [];
    let currentSegment: NormalizedActivityStart[] = [];

    normalized.forEach((entry, index) => {
      if (index === 0) {
        currentSegment.push(entry);
        return;
      }

      const previous = normalized[index - 1];
      const gapMs = entry.timestamp - previous.timestamp;
      const distanceKm = this.haversineDistanceKm(
        previous.latitudeDegrees,
        previous.longitudeDegrees,
        entry.latitudeDegrees,
        entry.longitudeDegrees
      );

      const shouldStartNewSegment = gapMs > MyTracksTripDetectionService.MAX_GAP_MS
        || distanceKm > MyTracksTripDetectionService.MAX_DISTANCE_KM;

      if (shouldStartNewSegment) {
        this.logger.log('[MyTracksTripDetectionService] Starting a new segment.', {
          previousEventId: previous.eventId,
          nextEventId: entry.eventId,
          gapHours: Number((gapMs / (60 * 60 * 1000)).toFixed(2)),
          distanceKm: Number(distanceKm.toFixed(2)),
          splitByTimeGap: gapMs > MyTracksTripDetectionService.MAX_GAP_MS,
          splitByDistance: distanceKm > MyTracksTripDetectionService.MAX_DISTANCE_KM,
        });
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
        }
        currentSegment = [entry];
        return;
      }

      currentSegment.push(entry);
    });

    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    const qualifiedSegments = segments
      .filter((segment, index) => this.isQualifyingTrip(segment, index))
      .map((segment) => this.toDetectedTrip(segment));

    this.logger.log('[MyTracksTripDetectionService] Trip detection completed.', {
      segmentCount: segments.length,
      detectedTripCount: qualifiedSegments.length,
      thresholds: {
        maxGapHours: MyTracksTripDetectionService.MAX_GAP_MS / (60 * 60 * 1000),
        maxDistanceKm: MyTracksTripDetectionService.MAX_DISTANCE_KM,
        minDurationDays: MyTracksTripDetectionService.MIN_DURATION_MS / (24 * 60 * 60 * 1000),
        minActivityCount: MyTracksTripDetectionService.MIN_ACTIVITY_COUNT,
      }
    });

    return qualifiedSegments;
  }

  private normalize(inputs: TripDetectionInput[]): NormalizationResult {
    const entries: NormalizedActivityStart[] = [];
    let droppedMissingEventId = 0;
    let droppedInvalidTimestamp = 0;
    let droppedInvalidCoordinates = 0;

    inputs.forEach((input) => {
      const timestamp = this.toTimestamp(input.startDate);
      if (!input.eventId) {
        droppedMissingEventId += 1;
        return;
      }
      if (timestamp === null) {
        droppedInvalidTimestamp += 1;
        return;
      }
      if (!Number.isFinite(input.latitudeDegrees) || !Number.isFinite(input.longitudeDegrees)) {
        droppedInvalidCoordinates += 1;
        return;
      }
      if (Math.abs(input.latitudeDegrees) > 90 || Math.abs(input.longitudeDegrees) > 180) {
        droppedInvalidCoordinates += 1;
        return;
      }

      entries.push({
        eventId: input.eventId,
        timestamp,
        latitudeDegrees: input.latitudeDegrees,
        longitudeDegrees: input.longitudeDegrees,
      } satisfies NormalizedActivityStart);
    });

    entries.sort((a, b) => a.timestamp - b.timestamp);

    return {
      entries,
      droppedMissingEventId,
      droppedInvalidTimestamp,
      droppedInvalidCoordinates,
    };
  }

  private isQualifyingTrip(segment: NormalizedActivityStart[], segmentIndex: number): boolean {
    if (segment.length < MyTracksTripDetectionService.MIN_ACTIVITY_COUNT) {
      this.logger.log('[MyTracksTripDetectionService] Segment rejected by minimum activity threshold.', {
        segmentIndex,
        activityCount: segment.length,
        requiredActivityCount: MyTracksTripDetectionService.MIN_ACTIVITY_COUNT,
      });
      return false;
    }

    const first = segment[0];
    const last = segment[segment.length - 1];
    const durationMs = last.timestamp - first.timestamp;

    if (durationMs < MyTracksTripDetectionService.MIN_DURATION_MS) {
      this.logger.log('[MyTracksTripDetectionService] Segment rejected by minimum duration threshold.', {
        segmentIndex,
        durationDays: Number((durationMs / (24 * 60 * 60 * 1000)).toFixed(2)),
        requiredDurationDays: MyTracksTripDetectionService.MIN_DURATION_MS / (24 * 60 * 60 * 1000),
      });
      return false;
    }

    return true;
  }

  private toDetectedTrip(segment: NormalizedActivityStart[]): DetectedTrip {
    const first = segment[0];
    const last = segment[segment.length - 1];
    const centroid = segment.reduce((accumulator, point) => {
      accumulator.lat += point.latitudeDegrees;
      accumulator.lng += point.longitudeDegrees;
      return accumulator;
    }, { lat: 0, lng: 0 });
    const bounds = segment.reduce((accumulator, point) => {
      accumulator.west = Math.min(accumulator.west, point.longitudeDegrees);
      accumulator.east = Math.max(accumulator.east, point.longitudeDegrees);
      accumulator.south = Math.min(accumulator.south, point.latitudeDegrees);
      accumulator.north = Math.max(accumulator.north, point.latitudeDegrees);
      return accumulator;
    }, {
      west: segment[0].longitudeDegrees,
      east: segment[0].longitudeDegrees,
      south: segment[0].latitudeDegrees,
      north: segment[0].latitudeDegrees,
    });

    return {
      tripId: this.getTripId(first, last, segment.length),
      startDate: new Date(first.timestamp),
      endDate: new Date(last.timestamp),
      activityCount: segment.length,
      centroidLat: centroid.lat / segment.length,
      centroidLng: centroid.lng / segment.length,
      bounds,
    };
  }

  private getTripId(first: NormalizedActivityStart, last: NormalizedActivityStart, activityCount: number): string {
    return `${first.eventId}-${last.eventId}-${first.timestamp}-${last.timestamp}-${activityCount}`;
  }

  private toTimestamp(value: Date | number | string | undefined): number | null {
    if (value instanceof Date) {
      const dateValue = value.getTime();
      return Number.isFinite(dateValue) ? dateValue : null;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRadians = (degrees: number) => degrees * (Math.PI / 180);
    const earthRadiusKm = 6371;

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
      * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
  }
}
