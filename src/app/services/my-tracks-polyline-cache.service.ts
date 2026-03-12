import { Injectable, inject } from '@angular/core';
import { ActivityInterface, ActivityTypes, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES } from '@sports-alliance/sports-lib';
import { del, get, set } from 'idb-keyval';
import { AppEventInterface } from '../../../functions/src/shared/app-event.interface';
import { AppOriginalFileHydrationService, DownloadFileOptions } from './app.original-file-hydration.service';
import { LoggerService } from './logger.service';

export interface CachedMyTracksJumpHeatPoint {
  lng: number;
  lat: number;
  hangTime: number | null;
  distance: number | null;
}

export interface CachedMyTracksActivityPolyline {
  activityId: string | null;
  activityIndex: number;
  coordinates: number[][];
  activityTypeValue: string | number | null;
  activityTypeLabel: string;
  durationValue: number | null;
  distanceValue: number | null;
  durationLabel: string;
  distanceLabel: string;
  effortLabel: string | null;
  effortDisplayLabel: string;
  effortStatType: string | null;
  jumpHeatPoints: CachedMyTracksJumpHeatPoint[];
}

export interface CachedMyTracksEventPolylines {
  activityCount: number;
  activityIdentitySignature: string[];
  trackActivities: CachedMyTracksActivityPolyline[];
}

export interface ResolvedMyTracksActivityPolyline {
  activity: ActivityInterface;
  activityIndex: number;
  coordinates: number[][];
  cachedActivity?: CachedMyTracksActivityPolyline;
}

interface SourceFileGeneration {
  path: string;
  generation: string;
}

@Injectable({
  providedIn: 'root',
})
export class MyTracksPolylineCacheService {
  private static readonly CACHE_KEY_PREFIX = 'my-tracks-polyline:v3';

  private logger = inject(LoggerService);
  private originalFileHydrationService = inject(AppOriginalFileHydrationService);

  public async resolveEventCacheKey(
    event: AppEventInterface,
    options?: DownloadFileOptions,
  ): Promise<string | null> {
    const eventId = event?.getID?.();
    const sourcePaths = this.getSourceFilePaths(event);
    if (!eventId || sourcePaths.length === 0) {
      return null;
    }

    try {
      const sourceFiles = await Promise.all(sourcePaths.map(async (path) => ({
        path,
        generation: await this.originalFileHydrationService.getFileGeneration(path, options),
      })));

      return this.buildCacheKey(eventId, sourceFiles);
    } catch (error) {
      this.logger.warn('[MyTracksPolylineCacheService] Failed to resolve event cache key.', {
        eventId,
        sourcePaths,
        error,
      });
      return null;
    }
  }

  public async getEventPolylines(cacheKey: string): Promise<CachedMyTracksEventPolylines | undefined> {
    try {
      return await get<CachedMyTracksEventPolylines>(cacheKey);
    } catch (error) {
      this.logger.warn('[MyTracksPolylineCacheService] Failed to get event polylines from cache.', {
        cacheKey,
        error,
      });
      return undefined;
    }
  }

  public async setEventPolylines(cacheKey: string, value: CachedMyTracksEventPolylines): Promise<void> {
    try {
      await set(cacheKey, value);
    } catch (error) {
      this.logger.warn('[MyTracksPolylineCacheService] Failed to set event polylines in cache.', {
        cacheKey,
        error,
      });
    }
  }

  public async deleteEventPolylines(cacheKey: string): Promise<void> {
    try {
      await del(cacheKey);
    } catch (error) {
      this.logger.warn('[MyTracksPolylineCacheService] Failed to delete event polylines from cache.', {
        cacheKey,
        error,
      });
    }
  }

  public extractTrackPolylines(activities: ActivityInterface[]): CachedMyTracksEventPolylines {
    const normalizedActivities = activities || [];
    return {
      activityCount: normalizedActivities.length,
      activityIdentitySignature: this.buildActivityIdentitySignature(normalizedActivities),
      trackActivities: normalizedActivities.reduce<CachedMyTracksActivityPolyline[]>((accumulator, activity, activityIndex) => {
        const coordinates = this.extractCoordinatesFromActivity(activity);
        if (coordinates.length <= 1) {
          return accumulator;
        }

        accumulator.push({
          activityId: this.getActivityId(activity),
          activityIndex,
          coordinates,
          activityTypeValue: this.getActivityTypeValue(activity),
          activityTypeLabel: this.resolveActivityTypeLabel(activity),
          durationValue: null,
          distanceValue: null,
          durationLabel: '-',
          distanceLabel: '-',
          effortLabel: null,
          effortDisplayLabel: '-',
          effortStatType: null,
          jumpHeatPoints: [],
        });
        return accumulator;
      }, []),
    };
  }

  public hasMatchingActivityIdentity(
    activities: ActivityInterface[],
    cachedPolylines: CachedMyTracksEventPolylines | undefined,
    allowUnknownIdentity: boolean = false,
  ): cachedPolylines is CachedMyTracksEventPolylines {
    if (!cachedPolylines) {
      return false;
    }

    const signature = this.buildActivityIdentitySignature(activities || []);
    if (allowUnknownIdentity && signature.length === 0 && cachedPolylines.activityCount > 0) {
      return true;
    }

    if (cachedPolylines.activityCount !== signature.length) {
      return false;
    }

    if (!Array.isArray(cachedPolylines.activityIdentitySignature)) {
      return false;
    }

    if (cachedPolylines.activityIdentitySignature.length !== signature.length) {
      return false;
    }

    return signature.every((identity, index) => cachedPolylines.activityIdentitySignature[index] === identity);
  }

  public hasCompleteTrackMetadata(cachedPolylines: CachedMyTracksEventPolylines | undefined): cachedPolylines is CachedMyTracksEventPolylines {
    if (!cachedPolylines) {
      return false;
    }

    if (
      !Number.isFinite(cachedPolylines.activityCount)
      || cachedPolylines.activityCount < 0
      || !Array.isArray(cachedPolylines.activityIdentitySignature)
      || cachedPolylines.activityIdentitySignature.length !== cachedPolylines.activityCount
      || !Array.isArray(cachedPolylines.trackActivities)
    ) {
      return false;
    }

    return cachedPolylines.trackActivities.every((activity) => this.hasCompleteTrackActivityMetadata(activity));
  }

  public resolveTrackPolylinesFromCache(
    cachedPolylines: CachedMyTracksEventPolylines,
  ): ResolvedMyTracksActivityPolyline[] {
    if (!cachedPolylines?.trackActivities?.length) {
      return [];
    }

    return cachedPolylines.trackActivities.reduce<ResolvedMyTracksActivityPolyline[]>((accumulator, cachedActivity) => {
      if (!this.hasValidCoordinates(cachedActivity?.coordinates)) {
        return accumulator;
      }

      accumulator.push({
        activity: this.buildSyntheticActivityFromCached(cachedActivity),
        activityIndex: cachedActivity.activityIndex,
        coordinates: cachedActivity.coordinates,
        cachedActivity,
      });
      return accumulator;
    }, []);
  }

  public resolveTrackPolylines(
    activities: ActivityInterface[],
    cachedPolylines: CachedMyTracksEventPolylines,
  ): ResolvedMyTracksActivityPolyline[] {
    if (!cachedPolylines?.trackActivities?.length) {
      return [];
    }

    if (!activities || activities.length === 0) {
      return this.resolveTrackPolylinesFromCache(cachedPolylines);
    }

    const activitiesById = new Map<string, { activity: ActivityInterface; activityIndex: number }>();
    activities.forEach((activity, activityIndex) => {
      const activityId = this.getActivityId(activity);
      if (!activityId || activitiesById.has(activityId)) {
        return;
      }
      activitiesById.set(activityId, { activity, activityIndex });
    });

    return cachedPolylines.trackActivities.reduce<ResolvedMyTracksActivityPolyline[]>((accumulator, cachedActivity) => {
      const activityId = cachedActivity.activityId;
      const activityMatch = activityId ? activitiesById.get(activityId) : undefined;
      const fallbackActivity = activities[cachedActivity.activityIndex];
      const resolvedActivity = activityMatch?.activity || fallbackActivity;
      const resolvedActivityIndex = activityMatch?.activityIndex ?? cachedActivity.activityIndex;

      if (!resolvedActivity || !this.hasValidCoordinates(cachedActivity.coordinates)) {
        return accumulator;
      }

      accumulator.push({
        activity: resolvedActivity,
        activityIndex: resolvedActivityIndex,
        coordinates: cachedActivity.coordinates,
        cachedActivity,
      });
      return accumulator;
    }, []);
  }

  private extractCoordinatesFromActivity(activity: ActivityInterface): number[][] {
    if (!activity?.hasPositionData?.()) {
      return [];
    }

    const precisionFactor = Math.pow(10, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES);
    return activity.getPositionData()
      .filter((position) => !!position)
      .map((position) => {
        const lng = Math.round(position.longitudeDegrees * precisionFactor) / precisionFactor;
        const lat = Math.round(position.latitudeDegrees * precisionFactor) / precisionFactor;
        return [lng, lat];
      })
      .filter((coordinate) =>
        Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])
        && Math.abs(coordinate[0]) <= 180
        && Math.abs(coordinate[1]) <= 90
      );
  }

  private getActivityId(activity: ActivityInterface): string | null {
    const activityId = activity?.getID?.();
    return typeof activityId === 'string' && activityId.trim().length > 0
      ? activityId
      : null;
  }

  private getActivityTypeValue(activity: ActivityInterface): string | number | null {
    const rawType = (activity as any)?.type;
    if (typeof rawType === 'string' && rawType.length > 0) {
      return rawType;
    }
    if (typeof rawType === 'number' && Number.isFinite(rawType)) {
      return rawType;
    }
    return null;
  }

  private resolveActivityTypeLabel(activity: ActivityInterface): string {
    const rawType = this.getActivityTypeValue(activity);
    if (rawType === null || rawType === undefined) {
      return 'Activity';
    }
    if (typeof rawType === 'number' && ActivityTypes[rawType]) {
      return String(ActivityTypes[rawType]);
    }
    return String(rawType);
  }

  private buildSyntheticActivityFromCached(cachedActivity: CachedMyTracksActivityPolyline): ActivityInterface {
    const activityId = cachedActivity.activityId;
    const typeValue = cachedActivity.activityTypeValue;
    return {
      type: typeValue ?? undefined,
      getID: () => activityId,
    } as ActivityInterface;
  }

  private buildActivityIdentitySignature(activities: ActivityInterface[]): string[] {
    return (activities || []).map((activity, activityIndex) => {
      const activityId = this.getActivityId(activity);
      if (activityId) {
        return `id:${activityId}`;
      }

      const activityType = typeof activity?.type === 'string' && activity.type.trim().length > 0
        ? activity.type
        : 'unknown';
      return `idx:${activityIndex}:type:${activityType}`;
    });
  }

  private hasCompleteTrackActivityMetadata(activity: CachedMyTracksActivityPolyline | undefined): boolean {
    return !!activity
      && typeof activity.activityId === 'string'
      && activity.activityId.trim().length > 0
      && this.hasValidCoordinates(activity.coordinates)
      && this.hasValidActivityTypeValue(activity.activityTypeValue)
      && typeof activity.activityTypeLabel === 'string'
      && activity.activityTypeLabel.trim().length > 0
      && this.isNullableNonNegativeNumber(activity.durationValue)
      && this.isNullableNonNegativeNumber(activity.distanceValue)
      && typeof activity.durationLabel === 'string'
      && activity.durationLabel.length > 0
      && typeof activity.distanceLabel === 'string'
      && activity.distanceLabel.length > 0
      && typeof activity.effortLabel === 'string'
      && activity.effortLabel.length > 0
      && typeof activity.effortDisplayLabel === 'string'
      && activity.effortDisplayLabel.length > 0
      && typeof activity.effortStatType === 'string'
      && activity.effortStatType.length > 0
      && Array.isArray(activity.jumpHeatPoints)
      && activity.jumpHeatPoints.every((point) => this.isValidJumpHeatPoint(point));
  }

  private hasValidCoordinates(coordinates: number[][] | undefined): boolean {
    return Array.isArray(coordinates)
      && coordinates.length > 1
      && coordinates.every((coordinate) =>
        Array.isArray(coordinate)
        && coordinate.length >= 2
        && Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])
        && Math.abs(coordinate[0]) <= 180
        && Math.abs(coordinate[1]) <= 90
      );
  }

  private hasValidActivityTypeValue(value: string | number | null): boolean {
    return (typeof value === 'string' && value.trim().length > 0)
      || (typeof value === 'number' && Number.isFinite(value));
  }

  private isNullableNonNegativeNumber(value: number | null): boolean {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
  }

  private isValidJumpHeatPoint(point: CachedMyTracksJumpHeatPoint | undefined): boolean {
    return !!point
      && Number.isFinite(point.lng)
      && Number.isFinite(point.lat)
      && Math.abs(point.lng) <= 180
      && Math.abs(point.lat) <= 90
      && this.isNullableNonNegativeNumber(point.hangTime)
      && this.isNullableNonNegativeNumber(point.distance);
  }

  private getSourceFilePaths(event: AppEventInterface): string[] {
    const originalFiles = Array.isArray(event?.originalFiles)
      ? event.originalFiles.filter((fileMeta) => !!fileMeta?.path)
      : [];

    if (originalFiles.length > 0) {
      return originalFiles.map((fileMeta) => fileMeta.path);
    }

    const legacyPath = event?.originalFile?.path;
    return legacyPath ? [legacyPath] : [];
  }

  private buildCacheKey(eventId: string, sourceFiles: SourceFileGeneration[]): string {
    const sourceSignature = sourceFiles
      .map((sourceFile) => `${sourceFile.path}@${sourceFile.generation}`)
      .join('|');

    return `${MyTracksPolylineCacheService.CACHE_KEY_PREFIX}:${eventId}:${sourceSignature}`;
  }
}
