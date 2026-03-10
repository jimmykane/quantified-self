import { Injectable } from '@angular/core';
import { LoggerService } from './logger.service';

export interface TripDetectionInput {
  eventId: string;
  startDate: Date | number | string | undefined;
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface TripDetectionOptions {
  homeInferenceInputs?: TripDetectionInput[];
}

export interface TripBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface DetectedTrip {
  tripId: string;
  destinationId: string;
  destinationVisitIndex: number;
  destinationVisitCount: number;
  isRevisit: boolean;
  eventIds: string[];
  startDate: Date;
  endDate: Date;
  activityCount: number;
  centroidLat: number;
  centroidLng: number;
  bounds: TripBounds;
}

export interface DetectedHomeArea {
  destinationId: string;
  pointCount: number;
  pointShare: number;
  centroidLat: number;
  centroidLng: number;
  bounds: TripBounds;
  radiusKm: number;
}

export interface TripDetectionResult {
  trips: DetectedTrip[];
  homeArea: DetectedHomeArea | null;
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

interface DestinationCluster {
  destinationId: string;
  points: NormalizedActivityStart[];
  pointShare: number;
  centroidLat: number;
  centroidLng: number;
  bounds: TripBounds;
  isNoise: boolean;
}

interface VisitWindow {
  destinationId: string;
  points: NormalizedActivityStart[];
  startTimestamp: number;
  endTimestamp: number;
}

interface QualificationResult {
  qualifiedVisitWindows: VisitWindow[];
  rejectionCounters: {
    rejected_by_activity_count: number;
    rejected_by_duration: number;
    rejected_as_home_noise: number;
  };
  visitWindowEvaluations: Array<{
    destinationId: string;
    startDateIso: string;
    endDateIso: string;
    activityCount: number;
    durationHours: number;
    isHomeWindow: boolean;
    status: 'qualified' | 'rejected';
    rejectedReason: 'activity_count' | 'duration' | 'home_noise' | null;
  }>;
}

interface RejoinResult {
  visitWindows: VisitWindow[];
  rejoinedVisitCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class MyTracksTripDetectionService {
  private static readonly DESTINATION_EPS_KM = 40;
  private static readonly DESTINATION_MIN_POINTS = 2;
  private static readonly VISIT_SPLIT_GAP_MS = 72 * 60 * 60 * 1000;
  private static readonly MIN_VISIT_ACTIVITY_COUNT = 1;
  private static readonly MIN_VISIT_DURATION_MS = 0;
  private static readonly HOME_CLUSTER_MIN_SHARE = 0.5;
  private static readonly HOME_MIN_ACTIVITY_COUNT = 4;
  private static readonly HOME_MIN_DURATION_MS = 72 * 60 * 60 * 1000;
  private static readonly SAME_DESTINATION_REJOIN_MAX_GAP_MS = 4 * 24 * 60 * 60 * 1000;
  private static readonly HOME_AREA_MIN_RADIUS_KM = 2.5;
  private static readonly HOME_AREA_MAX_RADIUS_KM = 25;
  private static readonly HOME_AREA_PADDING_MULTIPLIER = 1.35;
  private static readonly DESTINATION_ID_ROUNDING_DECIMALS = 3;
  private static readonly ENABLE_LEGACY_COMPARISON_LOG = false;

  private static readonly LEGACY_MAX_GAP_MS = 72 * 60 * 60 * 1000;
  private static readonly LEGACY_MAX_DISTANCE_KM = 180;
  private static readonly LEGACY_MIN_DURATION_MS = 4 * 24 * 60 * 60 * 1000;
  private static readonly LEGACY_MIN_ACTIVITY_COUNT = 3;

  constructor(
    private logger: LoggerService = new LoggerService(),
  ) { }

  public detectTrips(inputs: TripDetectionInput[], options: TripDetectionOptions = {}): DetectedTrip[] {
    return this.detectTripsWithContext(inputs, options).trips;
  }

  public detectTripsWithContext(inputs: TripDetectionInput[], options: TripDetectionOptions = {}): TripDetectionResult {
    if (!inputs || inputs.length === 0) {
      this.logger.log('[MyTracksTripDetectionService] No inputs provided for trip detection.');
      return {
        trips: [],
        homeArea: null,
      };
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
      return {
        trips: [],
        homeArea: null,
      };
    }

    this.logger.log('[MyTracksTripDetectionService] Activities payload for trip detection.', {
      activities: normalized.map((entry) => ({
        eventId: entry.eventId,
        timestamp: entry.timestamp,
        startDateIso: new Date(entry.timestamp).toISOString(),
        latitudeDegrees: entry.latitudeDegrees,
        longitudeDegrees: entry.longitudeDegrees,
      })),
    });

    const destinationClusters = this.clusterDestinations(normalized);
    const visitWindows = this.buildVisitWindows(destinationClusters, normalized);
    const rejoinResult = this.mergeAdjacentVisitWindows(visitWindows);
    const homeCluster = this.resolveMatchedHomeCluster(destinationClusters, options.homeInferenceInputs ?? inputs);
    const homeDestinationId = homeCluster?.destinationId ?? null;
    const qualificationResult = this.qualifyVisitWindows(rejoinResult.visitWindows, homeDestinationId);
    this.logger.log('[MyTracksTripDetectionService] Visit window evaluations.', {
      visitWindowEvaluations: qualificationResult.visitWindowEvaluations,
    });
    const detectedTrips = this.mapVisitWindowsToTrips(qualificationResult.qualifiedVisitWindows);
    const homeArea = homeCluster ? this.toDetectedHomeArea(homeCluster) : null;

    if (MyTracksTripDetectionService.ENABLE_LEGACY_COMPARISON_LOG) {
      const legacyCount = this.detectTripsLegacyCount(normalized);
      this.logger.log('[MyTracksTripDetectionService] Legacy vs V2 comparison.', {
        legacyCount,
        v2Count: detectedTrips.length,
      });
    }

    this.logger.log('[MyTracksTripDetectionService] Trip detection completed.', {
      inputCount: inputs.length,
      normalizedCount: normalized.length,
      clusterCount: destinationClusters.filter((cluster) => !cluster.isNoise).length,
      visitWindowCount: visitWindows.length,
      rejoinedVisitCount: rejoinResult.rejoinedVisitCount,
      qualifiedVisitCount: detectedTrips.length,
      homeClusterDetected: !!homeCluster,
      rejectionCounters: qualificationResult.rejectionCounters,
      thresholds: {
        destinationEpsKm: MyTracksTripDetectionService.DESTINATION_EPS_KM,
        destinationMinPoints: MyTracksTripDetectionService.DESTINATION_MIN_POINTS,
        visitSplitGapHours: MyTracksTripDetectionService.VISIT_SPLIT_GAP_MS / (60 * 60 * 1000),
        nonHomeMinActivityCount: MyTracksTripDetectionService.MIN_VISIT_ACTIVITY_COUNT,
        nonHomeMinDurationHours: MyTracksTripDetectionService.MIN_VISIT_DURATION_MS / (60 * 60 * 1000),
        homeClusterMinShare: MyTracksTripDetectionService.HOME_CLUSTER_MIN_SHARE,
        homeMinActivityCount: MyTracksTripDetectionService.HOME_MIN_ACTIVITY_COUNT,
        homeMinDurationHours: MyTracksTripDetectionService.HOME_MIN_DURATION_MS / (60 * 60 * 1000),
        sameDestinationRejoinGapHours: MyTracksTripDetectionService.SAME_DESTINATION_REJOIN_MAX_GAP_MS / (60 * 60 * 1000),
      }
    });

    return {
      trips: detectedTrips,
      homeArea,
    };
  }

  private clusterDestinations(entries: NormalizedActivityStart[]): DestinationCluster[] {
    const labels = this.runDbscan(entries);
    const clusterMap = new Map<number, NormalizedActivityStart[]>();
    const noisePoints: Array<{ point: NormalizedActivityStart; index: number }> = [];

    labels.forEach((label, index) => {
      if (label >= 0) {
        if (!clusterMap.has(label)) {
          clusterMap.set(label, []);
        }
        const clusterEntries = clusterMap.get(label);
        if (!clusterEntries) {
          return;
        }
        clusterEntries.push(entries[index]);
        return;
      }

      noisePoints.push({
        point: entries[index],
        index,
      });
    });

    const totalPointCount = entries.length;
    const clusters: DestinationCluster[] = [];
    const sortedClusters = Array.from(clusterMap.entries()).sort((a, b) => a[0] - b[0]);

    sortedClusters.forEach(([clusterIndex, points]) => {
      const summary = this.summarizePoints(points);
      clusters.push({
        destinationId: this.createDestinationId(summary.centroidLat, summary.centroidLng, clusterIndex),
        points,
        pointShare: points.length / totalPointCount,
        centroidLat: summary.centroidLat,
        centroidLng: summary.centroidLng,
        bounds: summary.bounds,
        isNoise: false,
      });
    });

    noisePoints.forEach((noisePoint) => {
      clusters.push({
        destinationId: `noise_${noisePoint.point.eventId}_${noisePoint.point.timestamp}_${noisePoint.index}`,
        points: [noisePoint.point],
        pointShare: 1 / totalPointCount,
        centroidLat: noisePoint.point.latitudeDegrees,
        centroidLng: noisePoint.point.longitudeDegrees,
        bounds: {
          west: noisePoint.point.longitudeDegrees,
          east: noisePoint.point.longitudeDegrees,
          south: noisePoint.point.latitudeDegrees,
          north: noisePoint.point.latitudeDegrees,
        },
        isNoise: true,
      });
    });

    return clusters;
  }

  private runDbscan(entries: NormalizedActivityStart[]): number[] {
    const unassignedLabel = -99;
    const noiseLabel = -1;
    const labels = new Array(entries.length).fill(unassignedLabel);
    const visited = new Array(entries.length).fill(false);
    let nextClusterLabel = 0;

    for (let index = 0; index < entries.length; index++) {
      if (visited[index]) continue;

      visited[index] = true;
      const neighbors = this.findNeighbors(entries, index, MyTracksTripDetectionService.DESTINATION_EPS_KM);

      if (neighbors.length < MyTracksTripDetectionService.DESTINATION_MIN_POINTS) {
        labels[index] = noiseLabel;
        continue;
      }

      this.expandCluster(entries, index, neighbors, nextClusterLabel, labels, visited, unassignedLabel, noiseLabel);
      nextClusterLabel += 1;
    }

    return labels;
  }

  private expandCluster(
    entries: NormalizedActivityStart[],
    seedIndex: number,
    seedNeighbors: number[],
    clusterLabel: number,
    labels: number[],
    visited: boolean[],
    unassignedLabel: number,
    noiseLabel: number,
  ): void {
    labels[seedIndex] = clusterLabel;
    const queue = [...seedNeighbors];
    const queued = new Set(seedNeighbors);

    while (queue.length > 0) {
      const currentIndex = queue.shift();
      if (currentIndex === undefined) {
        continue;
      }
      queued.delete(currentIndex);

      if (!visited[currentIndex]) {
        visited[currentIndex] = true;
        const currentNeighbors = this.findNeighbors(entries, currentIndex, MyTracksTripDetectionService.DESTINATION_EPS_KM);
        if (currentNeighbors.length >= MyTracksTripDetectionService.DESTINATION_MIN_POINTS) {
          currentNeighbors.forEach((neighborIndex) => {
            if (queued.has(neighborIndex)) return;
            queue.push(neighborIndex);
            queued.add(neighborIndex);
          });
        }
      }

      if (labels[currentIndex] === unassignedLabel || labels[currentIndex] === noiseLabel) {
        labels[currentIndex] = clusterLabel;
      }
    }
  }

  private findNeighbors(entries: NormalizedActivityStart[], index: number, epsKm: number): number[] {
    const source = entries[index];
    const neighbors: number[] = [];

    entries.forEach((candidate, candidateIndex) => {
      const distanceKm = this.haversineDistanceKm(
        source.latitudeDegrees,
        source.longitudeDegrees,
        candidate.latitudeDegrees,
        candidate.longitudeDegrees
      );

      if (distanceKm <= epsKm) {
        neighbors.push(candidateIndex);
      }
    });

    return neighbors;
  }

  private buildVisitWindows(
    destinationClusters: DestinationCluster[],
    timelinePoints: NormalizedActivityStart[],
  ): VisitWindow[] {
    if (timelinePoints.length === 0) {
      return [];
    }

    const destinationByPoint = new Map<NormalizedActivityStart, string>();
    destinationClusters.forEach((cluster) => {
      cluster.points.forEach((point) => {
        destinationByPoint.set(point, cluster.destinationId);
      });
    });

    const visitWindows: VisitWindow[] = [];
    let currentDestinationId: string | null = null;
    let currentWindowPoints: NormalizedActivityStart[] = [];

    timelinePoints.forEach((point) => {
      const destinationId = destinationByPoint.get(point);
      if (!destinationId) {
        this.logger.warn('[MyTracksTripDetectionService] Missing destination assignment for timeline point.', {
          eventId: point.eventId,
          timestamp: point.timestamp,
        });
        return;
      }

      if (!currentDestinationId) {
        currentDestinationId = destinationId;
        currentWindowPoints = [point];
        return;
      }

      const previousPoint = currentWindowPoints[currentWindowPoints.length - 1];
      const gapMs = point.timestamp - previousPoint.timestamp;
      const hasDestinationChanged = destinationId !== currentDestinationId;
      const hasLargeGap = gapMs > MyTracksTripDetectionService.VISIT_SPLIT_GAP_MS;

      if (hasDestinationChanged || hasLargeGap) {
        visitWindows.push(this.createVisitWindow(currentDestinationId, currentWindowPoints));
        currentDestinationId = destinationId;
        currentWindowPoints = [point];
        return;
      }

      currentWindowPoints.push(point);
    });

    if (currentDestinationId && currentWindowPoints.length > 0) {
      visitWindows.push(this.createVisitWindow(currentDestinationId, currentWindowPoints));
    }

    return visitWindows
      .sort((a, b) => a.startTimestamp - b.startTimestamp || a.destinationId.localeCompare(b.destinationId));
  }

  private createVisitWindow(destinationId: string, points: NormalizedActivityStart[]): VisitWindow {
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    return {
      destinationId,
      points,
      startTimestamp: firstPoint.timestamp,
      endTimestamp: lastPoint.timestamp,
    };
  }

  private identifyHomeCluster(destinationClusters: DestinationCluster[]): DestinationCluster | null {
    const nonNoiseClusters = destinationClusters.filter((cluster) => !cluster.isNoise);
    if (nonNoiseClusters.length === 0) {
      return null;
    }

    const sortedByShare = [...nonNoiseClusters].sort((a, b) => {
      if (b.pointShare !== a.pointShare) {
        return b.pointShare - a.pointShare;
      }
      return a.destinationId.localeCompare(b.destinationId);
    });

    const strongestCluster = sortedByShare[0];
    if (strongestCluster.pointShare < MyTracksTripDetectionService.HOME_CLUSTER_MIN_SHARE) {
      return null;
    }

    return strongestCluster;
  }

  private resolveMatchedHomeCluster(
    currentDestinationClusters: DestinationCluster[],
    homeInferenceInputs: TripDetectionInput[],
  ): DestinationCluster | null {
    if (!homeInferenceInputs || homeInferenceInputs.length === 0) {
      return null;
    }

    const homeInferenceNormalizationResult = this.normalize(homeInferenceInputs);
    const normalizedHomeInferenceEntries = homeInferenceNormalizationResult.entries;
    if (normalizedHomeInferenceEntries.length === 0) {
      return null;
    }

    const inferredHomeCluster = this.identifyHomeCluster(this.clusterDestinations(normalizedHomeInferenceEntries));
    if (!inferredHomeCluster) {
      return null;
    }

    const matchingCurrentClusters = currentDestinationClusters.filter((cluster) => (
      !cluster.isNoise
      && this.haversineDistanceKm(
        cluster.centroidLat,
        cluster.centroidLng,
        inferredHomeCluster.centroidLat,
        inferredHomeCluster.centroidLng,
      ) <= MyTracksTripDetectionService.DESTINATION_EPS_KM
    ));

    return matchingCurrentClusters.length === 1
      ? matchingCurrentClusters[0]
      : null;
  }

  private qualifyVisitWindows(visitWindows: VisitWindow[], homeDestinationId: string | null): QualificationResult {
    const rejectionCounters = {
      rejected_by_activity_count: 0,
      rejected_by_duration: 0,
      rejected_as_home_noise: 0,
    };
    const qualifiedVisitWindows: VisitWindow[] = [];
    const visitWindowEvaluations: QualificationResult['visitWindowEvaluations'] = [];
    const visitWindowCountsByDestination = visitWindows.reduce((accumulator, window) => {
      accumulator.set(window.destinationId, (accumulator.get(window.destinationId) || 0) + 1);
      return accumulator;
    }, new Map<string, number>());

    visitWindows.forEach((visitWindow) => {
      const activityCount = visitWindow.points.length;
      const durationMs = visitWindow.endTimestamp - visitWindow.startTimestamp;
      const durationHours = Number((durationMs / (60 * 60 * 1000)).toFixed(2));
      const isHomeWindow = !!homeDestinationId && visitWindow.destinationId === homeDestinationId;
      const destinationVisitCount = visitWindowCountsByDestination.get(visitWindow.destinationId) || 1;

      if (isHomeWindow) {
        rejectionCounters.rejected_as_home_noise += 1;
        visitWindowEvaluations.push({
          destinationId: visitWindow.destinationId,
          startDateIso: new Date(visitWindow.startTimestamp).toISOString(),
          endDateIso: new Date(visitWindow.endTimestamp).toISOString(),
          activityCount,
          durationHours,
          isHomeWindow,
          status: 'rejected',
          rejectedReason: 'home_noise',
        });
        return;
      }

      if (activityCount < MyTracksTripDetectionService.MIN_VISIT_ACTIVITY_COUNT) {
        rejectionCounters.rejected_by_activity_count += 1;
        visitWindowEvaluations.push({
          destinationId: visitWindow.destinationId,
          startDateIso: new Date(visitWindow.startTimestamp).toISOString(),
          endDateIso: new Date(visitWindow.endTimestamp).toISOString(),
          activityCount,
          durationHours,
          isHomeWindow,
          status: 'rejected',
          rejectedReason: 'activity_count',
        });
        return;
      }

      // Avoid over-detecting one-off points when permissive thresholds are enabled.
      if (activityCount === 1 && destinationVisitCount < 2) {
        rejectionCounters.rejected_by_activity_count += 1;
        visitWindowEvaluations.push({
          destinationId: visitWindow.destinationId,
          startDateIso: new Date(visitWindow.startTimestamp).toISOString(),
          endDateIso: new Date(visitWindow.endTimestamp).toISOString(),
          activityCount,
          durationHours,
          isHomeWindow,
          status: 'rejected',
          rejectedReason: 'activity_count',
        });
        return;
      }

      if (durationMs < MyTracksTripDetectionService.MIN_VISIT_DURATION_MS) {
        rejectionCounters.rejected_by_duration += 1;
        visitWindowEvaluations.push({
          destinationId: visitWindow.destinationId,
          startDateIso: new Date(visitWindow.startTimestamp).toISOString(),
          endDateIso: new Date(visitWindow.endTimestamp).toISOString(),
          activityCount,
          durationHours,
          isHomeWindow,
          status: 'rejected',
          rejectedReason: 'duration',
        });
        return;
      }

      qualifiedVisitWindows.push(visitWindow);
      visitWindowEvaluations.push({
        destinationId: visitWindow.destinationId,
        startDateIso: new Date(visitWindow.startTimestamp).toISOString(),
        endDateIso: new Date(visitWindow.endTimestamp).toISOString(),
        activityCount,
        durationHours,
        isHomeWindow,
        status: 'qualified',
        rejectedReason: null,
      });
    });

    return {
      qualifiedVisitWindows,
      rejectionCounters,
      visitWindowEvaluations,
    };
  }

  private mergeAdjacentVisitWindows(visitWindows: VisitWindow[]): RejoinResult {
    if (visitWindows.length <= 1) {
      return {
        visitWindows: [...visitWindows],
        rejoinedVisitCount: 0,
      };
    }

    const mergedVisitWindows: VisitWindow[] = [];
    let currentWindow = visitWindows[0];
    let rejoinedVisitCount = 0;

    for (let index = 1; index < visitWindows.length; index++) {
      const nextWindow = visitWindows[index];
      const gapMs = nextWindow.startTimestamp - currentWindow.endTimestamp;
      const isSameDestination = currentWindow.destinationId === nextWindow.destinationId;
      const hasShortGap = gapMs >= 0 && gapMs <= MyTracksTripDetectionService.SAME_DESTINATION_REJOIN_MAX_GAP_MS;

      if (isSameDestination && hasShortGap) {
        currentWindow = {
          destinationId: currentWindow.destinationId,
          points: [...currentWindow.points, ...nextWindow.points]
            .sort((a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId)),
          startTimestamp: currentWindow.startTimestamp,
          endTimestamp: Math.max(currentWindow.endTimestamp, nextWindow.endTimestamp),
        };
        rejoinedVisitCount += 1;
        continue;
      }

      mergedVisitWindows.push(currentWindow);
      currentWindow = nextWindow;
    }

    mergedVisitWindows.push(currentWindow);

    return {
      visitWindows: mergedVisitWindows,
      rejoinedVisitCount,
    };
  }

  private mapVisitWindowsToTrips(qualifiedVisitWindows: VisitWindow[]): DetectedTrip[] {
    const groupedByDestination = new Map<string, VisitWindow[]>();
    qualifiedVisitWindows.forEach((visitWindow) => {
      if (!groupedByDestination.has(visitWindow.destinationId)) {
        groupedByDestination.set(visitWindow.destinationId, []);
      }
      const windowsForDestination = groupedByDestination.get(visitWindow.destinationId);
      if (!windowsForDestination) {
        return;
      }
      windowsForDestination.push(visitWindow);
    });

    const detectedTrips: DetectedTrip[] = [];
    groupedByDestination.forEach((windowsForDestination) => {
      const sortedWindows = [...windowsForDestination]
        .sort((a, b) => a.startTimestamp - b.startTimestamp || a.endTimestamp - b.endTimestamp);
      const destinationVisitCount = sortedWindows.length;

      sortedWindows.forEach((visitWindow, index) => {
        detectedTrips.push(this.toDetectedTrip(visitWindow, index + 1, destinationVisitCount));
      });
    });

    return detectedTrips
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || a.destinationId.localeCompare(b.destinationId));
  }

  private toDetectedTrip(visitWindow: VisitWindow, destinationVisitIndex: number, destinationVisitCount: number): DetectedTrip {
    const summary = this.summarizePoints(visitWindow.points);
    const startTimestamp = visitWindow.startTimestamp;
    const endTimestamp = visitWindow.endTimestamp;
    const activityCount = visitWindow.points.length;

    return {
      tripId: `trip_${visitWindow.destinationId}_${startTimestamp}_${endTimestamp}_${activityCount}`,
      destinationId: visitWindow.destinationId,
      destinationVisitIndex,
      destinationVisitCount,
      isRevisit: destinationVisitIndex > 1,
      eventIds: Array.from(new Set(visitWindow.points.map((point) => point.eventId))),
      startDate: new Date(startTimestamp),
      endDate: new Date(endTimestamp),
      activityCount,
      centroidLat: summary.centroidLat,
      centroidLng: summary.centroidLng,
      bounds: summary.bounds,
    };
  }

  private toDetectedHomeArea(cluster: DestinationCluster): DetectedHomeArea {
    return {
      destinationId: cluster.destinationId,
      pointCount: cluster.points.length,
      pointShare: cluster.pointShare,
      centroidLat: cluster.centroidLat,
      centroidLng: cluster.centroidLng,
      bounds: cluster.bounds,
      radiusKm: this.estimateHomeAreaRadiusKm(cluster),
    };
  }

  private estimateHomeAreaRadiusKm(cluster: DestinationCluster): number {
    const maxDistanceKm = cluster.points.reduce((currentMax, point) => (
      Math.max(
        currentMax,
        this.haversineDistanceKm(
          cluster.centroidLat,
          cluster.centroidLng,
          point.latitudeDegrees,
          point.longitudeDegrees,
        ),
      )
    ), 0);

    const paddedRadiusKm = maxDistanceKm * MyTracksTripDetectionService.HOME_AREA_PADDING_MULTIPLIER;

    return Math.min(
      MyTracksTripDetectionService.HOME_AREA_MAX_RADIUS_KM,
      Math.max(MyTracksTripDetectionService.HOME_AREA_MIN_RADIUS_KM, paddedRadiusKm),
    );
  }

  private summarizePoints(points: NormalizedActivityStart[]): {
    centroidLat: number;
    centroidLng: number;
    bounds: TripBounds;
  } {
    const centroid = points.reduce((accumulator, point) => {
      accumulator.lat += point.latitudeDegrees;
      accumulator.lng += point.longitudeDegrees;
      return accumulator;
    }, { lat: 0, lng: 0 });

    const bounds = points.reduce((accumulator, point) => {
      accumulator.west = Math.min(accumulator.west, point.longitudeDegrees);
      accumulator.east = Math.max(accumulator.east, point.longitudeDegrees);
      accumulator.south = Math.min(accumulator.south, point.latitudeDegrees);
      accumulator.north = Math.max(accumulator.north, point.latitudeDegrees);
      return accumulator;
    }, {
      west: points[0].longitudeDegrees,
      east: points[0].longitudeDegrees,
      south: points[0].latitudeDegrees,
      north: points[0].latitudeDegrees,
    });

    return {
      centroidLat: centroid.lat / points.length,
      centroidLng: centroid.lng / points.length,
      bounds,
    };
  }

  private createDestinationId(centroidLat: number, centroidLng: number, clusterIndex: number): string {
    const roundedLat = centroidLat.toFixed(MyTracksTripDetectionService.DESTINATION_ID_ROUNDING_DECIMALS);
    const roundedLng = centroidLng.toFixed(MyTracksTripDetectionService.DESTINATION_ID_ROUNDING_DECIMALS);
    return `destination_${roundedLat}_${roundedLng}_${clusterIndex}`;
  }

  private detectTripsLegacyCount(normalized: NormalizedActivityStart[]): number {
    if (normalized.length === 0) return 0;

    const segments: NormalizedActivityStart[][] = [];
    let currentSegment: NormalizedActivityStart[] = [normalized[0]];

    for (let index = 1; index < normalized.length; index++) {
      const current = normalized[index];
      const previous = normalized[index - 1];
      const gapMs = current.timestamp - previous.timestamp;
      const distanceKm = this.haversineDistanceKm(
        previous.latitudeDegrees,
        previous.longitudeDegrees,
        current.latitudeDegrees,
        current.longitudeDegrees
      );

      const shouldSplit = gapMs > MyTracksTripDetectionService.LEGACY_MAX_GAP_MS
        || distanceKm > MyTracksTripDetectionService.LEGACY_MAX_DISTANCE_KM;

      if (shouldSplit) {
        segments.push(currentSegment);
        currentSegment = [current];
        continue;
      }

      currentSegment.push(current);
    }

    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    return segments.filter((segment) => {
      if (segment.length < MyTracksTripDetectionService.LEGACY_MIN_ACTIVITY_COUNT) return false;
      const durationMs = segment[segment.length - 1].timestamp - segment[0].timestamp;
      return durationMs >= MyTracksTripDetectionService.LEGACY_MIN_DURATION_MS;
    }).length;
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

    entries.sort((a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId));

    return {
      entries,
      droppedMissingEventId,
      droppedInvalidTimestamp,
      droppedInvalidCoordinates,
    };
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
