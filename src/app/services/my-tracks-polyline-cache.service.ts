import { Injectable, inject } from '@angular/core';
import { ActivityInterface, GNSS_DEGREES_PRECISION_NUMBER_OF_DECIMAL_PLACES } from '@sports-alliance/sports-lib';
import { get, set } from 'idb-keyval';
import { AppEventInterface } from '../../../functions/src/shared/app-event.interface';
import { AppOriginalFileHydrationService, DownloadFileOptions } from './app.original-file-hydration.service';
import { LoggerService } from './logger.service';

export interface CachedMyTracksActivityPolyline {
  activityId: string | null;
  activityIndex: number;
  coordinates: number[][];
}

export interface CachedMyTracksEventPolylines {
  activityCount: number;
  trackActivities: CachedMyTracksActivityPolyline[];
}

export interface ResolvedMyTracksActivityPolyline {
  activity: ActivityInterface;
  activityIndex: number;
  coordinates: number[][];
}

interface SourceFileGeneration {
  path: string;
  generation: string;
}

@Injectable({
  providedIn: 'root',
})
export class MyTracksPolylineCacheService {
  private static readonly CACHE_KEY_PREFIX = 'my-tracks-polyline:v1';

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

  public extractTrackPolylines(activities: ActivityInterface[]): CachedMyTracksEventPolylines {
    return {
      activityCount: activities?.length || 0,
      trackActivities: (activities || []).reduce<CachedMyTracksActivityPolyline[]>((accumulator, activity, activityIndex) => {
        const coordinates = this.extractCoordinatesFromActivity(activity);
        if (coordinates.length <= 1) {
          return accumulator;
        }

        accumulator.push({
          activityId: this.getActivityId(activity),
          activityIndex,
          coordinates,
        });
        return accumulator;
      }, []),
    };
  }

  public resolveTrackPolylines(
    activities: ActivityInterface[],
    cachedPolylines: CachedMyTracksEventPolylines,
  ): ResolvedMyTracksActivityPolyline[] {
    if (!activities || activities.length === 0 || !cachedPolylines?.trackActivities?.length) {
      return [];
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

      if (!resolvedActivity || !Array.isArray(cachedActivity.coordinates) || cachedActivity.coordinates.length <= 1) {
        return accumulator;
      }

      accumulator.push({
        activity: resolvedActivity,
        activityIndex: resolvedActivityIndex,
        coordinates: cachedActivity.coordinates,
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
