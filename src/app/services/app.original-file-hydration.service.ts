import { Injectable, inject } from '@angular/core';
import {
  ActivityInterface,
  DataDistance,
  DataDuration,
  EventImporterFIT,
  EventImporterGPX,
  EventImporterSuuntoJSON,
  EventImporterSuuntoSML,
  EventImporterTCX,
  EventInterface,
  EventUtilities,
} from '@sports-alliance/sports-lib';
import { Storage, getBytes, getMetadata, ref } from 'app/firebase/storage';
import { AppFileService } from './app.file.service';
import { LoggerService } from './logger.service';
import { AppEventUtilities } from '../utils/app.event.utilities';
import { AppCacheService } from './app.cache.service';
import { EventJSONSanitizer } from '../utils/event-json-sanitizer';
import { AppEventInterface, OriginalFileMetaData } from '@shared/app-event.interface';
import { createParsingOptions } from '@shared/parsing-options';

export interface ParseOptions {
  skipEnrichment?: boolean;
  strictAllFilesRequired?: boolean;
  preserveActivityIdsFromEvent?: boolean;
  mergeMultipleFiles?: boolean;
  metadataCacheTtlMs?: number;
  streamTypes?: string[];
}

export interface ParseFailure {
  path: string;
  reason: string;
}

export interface ParseResult {
  finalEvent: EventInterface | null;
  parsedEvents: EventInterface[];
  sourceFilesCount: number;
  failedFiles: ParseFailure[];
}

export interface DownloadFileOptions {
  metadataCacheTtlMs?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AppOriginalFileHydrationService {
  private static readonly DEFAULT_METADATA_CACHE_TTL_MS = 30000;

  private storage = inject(Storage);
  private fileService = inject(AppFileService);
  private logger = inject(LoggerService);
  private appEventUtilities = inject(AppEventUtilities);
  private cacheService = inject(AppCacheService);
  private metadataGenerationCache = new Map<string, { generation: string; expiresAt: number }>();
  private inFlightMetadataByPath = new Map<string, Promise<string>>();
  private inFlightMetadataTtlByPath = new Map<string, number>();

  public async downloadFile(path: string, options?: DownloadFileOptions): Promise<ArrayBuffer> {
    const fileRef = ref(this.storage, path);
    const metadataCacheTtlMs = this.getMetadataCacheTtlMs(options);

    try {
      const generation = await this.getGeneration(path, fileRef, metadataCacheTtlMs);
      const cached = await this.cacheService.getFile(path);

      if (cached && cached.generation === generation) {
        this.logger.log(`[AppOriginalFileHydrationService] Cache HIT for ${path}`);
        return this.fileService.decompressIfNeeded(cached.buffer, path);
      }

      this.logger.log(`[AppOriginalFileHydrationService] Cache MISS/STALE for ${path} (Cloud Gen: ${generation}, Cached Gen: ${cached?.generation})`);
      const buffer = await getBytes(fileRef);
      await this.cacheService.setFile(path, { buffer, generation });
      return this.fileService.decompressIfNeeded(buffer, path);
    } catch (e) {
      this.logger.error(`[AppOriginalFileHydrationService] Error downloading/caching file ${path}`, e);
      const buffer = await getBytes(fileRef);
      return this.fileService.decompressIfNeeded(buffer, path);
    }
  }

  public async getFileGeneration(path: string, options?: DownloadFileOptions): Promise<string> {
    const fileRef = ref(this.storage, path);
    return this.getGeneration(path, fileRef, this.getMetadataCacheTtlMs(options));
  }

  private getMetadataCacheTtlMs(options?: DownloadFileOptions): number {
    const metadataCacheTtlMs = options?.metadataCacheTtlMs;
    if (metadataCacheTtlMs === undefined || metadataCacheTtlMs === null || !Number.isFinite(metadataCacheTtlMs)) {
      return AppOriginalFileHydrationService.DEFAULT_METADATA_CACHE_TTL_MS;
    }

    if (metadataCacheTtlMs <= 0) {
      return 0;
    }

    return metadataCacheTtlMs;
  }

  private pruneExpiredMetadataCache(now: number): void {
    for (const [path, value] of this.metadataGenerationCache) {
      if (value.expiresAt <= now) {
        this.metadataGenerationCache.delete(path);
      }
    }
  }

  private async getGeneration(path: string, fileRef: ReturnType<typeof ref>, metadataCacheTtlMs: number): Promise<string> {
    const now = Date.now();
    if (metadataCacheTtlMs > 0) {
      this.pruneExpiredMetadataCache(now);
      const cachedMetadata = this.metadataGenerationCache.get(path);
      if (cachedMetadata && cachedMetadata.expiresAt > now) {
        return cachedMetadata.generation;
      }
    }

    const existingInFlight = this.inFlightMetadataByPath.get(path);
    if (existingInFlight) {
      const existingTtl = this.inFlightMetadataTtlByPath.get(path) ?? 0;
      if (metadataCacheTtlMs > existingTtl) {
        this.inFlightMetadataTtlByPath.set(path, metadataCacheTtlMs);
      }
      return existingInFlight;
    }

    const metadataPromise = (async (): Promise<string> => {
      const metadata = await getMetadata(fileRef);
      const generation = metadata.generation;
      const effectiveTtlMs = this.inFlightMetadataTtlByPath.get(path) ?? metadataCacheTtlMs;

      if (effectiveTtlMs > 0) {
        this.metadataGenerationCache.set(path, {
          generation,
          expiresAt: Date.now() + effectiveTtlMs,
        });
      } else {
        this.metadataGenerationCache.delete(path);
      }

      return generation;
    })();

    this.inFlightMetadataByPath.set(path, metadataPromise);
    this.inFlightMetadataTtlByPath.set(path, metadataCacheTtlMs);
    try {
      return await metadataPromise;
    } finally {
      if (this.inFlightMetadataByPath.get(path) === metadataPromise) {
        this.inFlightMetadataByPath.delete(path);
      }
      this.inFlightMetadataTtlByPath.delete(path);
    }
  }

  public async parseEventFromOriginalFiles(event: AppEventInterface, options: ParseOptions = {}): Promise<ParseResult> {
    const strictAllFilesRequired = options.strictAllFilesRequired === true;
    const preserveActivityIdsFromEvent = options.preserveActivityIdsFromEvent !== false;
    const mergeMultipleFiles = options.mergeMultipleFiles !== false;
    const sourceFiles = this.getSourceFiles(event);
    const parsedEvents: EventInterface[] = [];
    const failedFiles: ParseFailure[] = [];

    for (const sourceFile of sourceFiles) {
      const result = await this.fetchAndParseOneFile(
        sourceFile,
        options.skipEnrichment === true,
        options.metadataCacheTtlMs,
        options.streamTypes,
      );
      if (result.event) {
        parsedEvents.push(result.event);
      } else {
        failedFiles.push({
          path: sourceFile.path,
          reason: result.reason || 'Unknown parse failure',
        });
      }
    }

    if (strictAllFilesRequired && failedFiles.length > 0) {
      return {
        finalEvent: null,
        parsedEvents,
        sourceFilesCount: sourceFiles.length,
        failedFiles,
      };
    }

    const validEvents = parsedEvents.filter((parsedEvent) => !!parsedEvent);
    if (validEvents.length === 0) {
      return {
        finalEvent: null,
        parsedEvents: [],
        sourceFilesCount: sourceFiles.length,
        failedFiles,
      };
    }

    const finalEvent = (mergeMultipleFiles && validEvents.length > 1)
      ? EventUtilities.mergeEvents(validEvents)
      : validEvents[0];

    if (preserveActivityIdsFromEvent) {
      this.applyExistingActivityIdentity(event, finalEvent);
    }

    return {
      finalEvent,
      parsedEvents: validEvents,
      sourceFilesCount: sourceFiles.length,
      failedFiles,
    };
  }

  private getSourceFiles(event: AppEventInterface): OriginalFileMetaData[] {
    if (event.originalFiles && event.originalFiles.length > 0) {
      return event.originalFiles.filter(file => !!file?.path);
    }

    if (event.originalFile && event.originalFile.path) {
      return [event.originalFile];
    }

    return [];
  }

  private applyExistingActivityIdentity(existingEvent: AppEventInterface, parsedEvent: EventInterface): void {
    const existingActivities = existingEvent.getActivities() || [];
    const parsedActivities = parsedEvent.getActivities() || [];
    if (!existingActivities.length || !parsedActivities.length) {
      return;
    }

    const assignedParsedToExistingIndex = this.resolveActivityIdentityAssignments(existingActivities, parsedActivities);

    assignedParsedToExistingIndex.forEach((existingIndex, parsedIndex) => {
      const existingActivity = existingActivities[existingIndex];
      const parsedActivity = parsedActivities[parsedIndex];
      if (!existingActivity || !parsedActivity) {
        return;
      }

      const existingId = existingActivity.getID();
      if (existingId) {
        parsedActivity.setID(existingId);
      }
      const existingSourceActivityKey = this.getActivitySourceActivityKey(existingActivity);
      if (existingSourceActivityKey && !this.getActivitySourceActivityKey(parsedActivity)) {
        (parsedActivity as any).sourceActivityKey = existingSourceActivityKey;
      }
      this.applyUserActivityOverrides(existingActivity, parsedActivity);
    });

    if (assignedParsedToExistingIndex.size !== parsedActivities.length) {
      const assignedParsedIndexes = new Set(assignedParsedToExistingIndex.keys());
      const assignedExistingIndexes = new Set(assignedParsedToExistingIndex.values());
      const unmatchedParsed = parsedActivities
        .map((activity, index) => ({ activity, index }))
        .filter(({ index }) => !assignedParsedIndexes.has(index))
        .map(({ activity, index }) => ({
          index,
          id: activity.getID?.() || null,
          sourceActivityKey: this.getActivitySourceActivityKey(activity),
          startMs: this.toTimestampMs((activity as any)?.startDate),
          type: `${(activity as any)?.type || ''}`.trim() || null,
        }));
      const unmatchedExisting = existingActivities
        .map((activity, index) => ({ activity, index }))
        .filter(({ index }) => !assignedExistingIndexes.has(index))
        .map(({ activity, index }) => ({
          index,
          id: activity.getID?.() || null,
          sourceActivityKey: this.getActivitySourceActivityKey(activity),
          startMs: this.toTimestampMs((activity as any)?.startDate),
          type: `${(activity as any)?.type || ''}`.trim() || null,
        }));

      this.logger.warn('[AppOriginalFileHydrationService] Could not deterministically map all parsed activities to existing identities', {
        eventID: existingEvent.getID?.() || null,
        parsedCount: parsedActivities.length,
        existingCount: existingActivities.length,
        assignedCount: assignedParsedToExistingIndex.size,
        unmatchedParsed,
        unmatchedExisting,
      });
    }
  }

  private resolveActivityIdentityAssignments(
    existingActivities: ActivityInterface[],
    parsedActivities: ActivityInterface[],
  ): Map<number, number> {
    const assignments = new Map<number, number>();
    const usedExistingIndexes = new Set<number>();

    const assign = (parsedIndex: number, existingIndex: number): void => {
      if (assignments.has(parsedIndex) || usedExistingIndexes.has(existingIndex)) {
        return;
      }
      assignments.set(parsedIndex, existingIndex);
      usedExistingIndexes.add(existingIndex);
    };

    const findUnassignedExistingById = (id: string): number[] =>
      existingActivities.reduce<number[]>((matches, activity, index) => {
        if (usedExistingIndexes.has(index)) {
          return matches;
        }
        if ((activity.getID?.() || '') === id) {
          matches.push(index);
        }
        return matches;
      }, []);

    this.assignUniqueMatchesBySignature(
      existingActivities,
      parsedActivities,
      assignments,
      usedExistingIndexes,
      (activity) => this.getActivitySourceActivityKey(activity),
    );

    parsedActivities.forEach((parsedActivity, parsedIndex) => {
      const parsedId = parsedActivity.getID?.();
      if (!parsedId) {
        return;
      }
      const byIdMatches = findUnassignedExistingById(parsedId);
      if (byIdMatches.length === 1) {
        assign(parsedIndex, byIdMatches[0]);
      }
    });

    this.assignUniqueMatchesBySignature(
      existingActivities,
      parsedActivities,
      assignments,
      usedExistingIndexes,
      (activity) => this.getStrictIdentitySignature(activity),
    );
    this.assignUniqueMatchesBySignature(
      existingActivities,
      parsedActivities,
      assignments,
      usedExistingIndexes,
      (activity) => this.getTimeTypeIdentitySignature(activity),
    );
    this.assignUniqueMatchesBySignature(
      existingActivities,
      parsedActivities,
      assignments,
      usedExistingIndexes,
      (activity) => this.getStartIdentitySignature(activity),
    );

    const remainingParsedIndexes = parsedActivities
      .map((_activity, index) => index)
      .filter((index) => !assignments.has(index));
    const remainingExistingIndexes = existingActivities
      .map((_activity, index) => index)
      .filter((index) => !usedExistingIndexes.has(index));
    if (remainingParsedIndexes.length === 1 && remainingExistingIndexes.length === 1) {
      assign(remainingParsedIndexes[0], remainingExistingIndexes[0]);
    }

    return assignments;
  }

  private getActivitySourceActivityKey(activity: ActivityInterface): string | null {
    const sourceActivityKey = `${(activity as any)?.sourceActivityKey || ''}`.trim();
    return sourceActivityKey.length > 0 ? sourceActivityKey : null;
  }

  private assignUniqueMatchesBySignature(
    existingActivities: ActivityInterface[],
    parsedActivities: ActivityInterface[],
    assignments: Map<number, number>,
    usedExistingIndexes: Set<number>,
    signatureResolver: (activity: ActivityInterface) => string | null,
  ): void {
    const existingBySignature = new Map<string, number[]>();
    existingActivities.forEach((activity, index) => {
      if (usedExistingIndexes.has(index)) {
        return;
      }
      const signature = signatureResolver(activity);
      if (!signature) {
        return;
      }
      const list = existingBySignature.get(signature) || [];
      list.push(index);
      existingBySignature.set(signature, list);
    });

    const parsedBySignature = new Map<string, number[]>();
    parsedActivities.forEach((activity, index) => {
      if (assignments.has(index)) {
        return;
      }
      const signature = signatureResolver(activity);
      if (!signature) {
        return;
      }
      const list = parsedBySignature.get(signature) || [];
      list.push(index);
      parsedBySignature.set(signature, list);
    });

    parsedBySignature.forEach((parsedIndexes, signature) => {
      const existingIndexes = existingBySignature.get(signature) || [];
      if (parsedIndexes.length !== 1 || existingIndexes.length !== 1) {
        return;
      }
      const parsedIndex = parsedIndexes[0];
      const existingIndex = existingIndexes[0];
      if (assignments.has(parsedIndex) || usedExistingIndexes.has(existingIndex)) {
        return;
      }
      assignments.set(parsedIndex, existingIndex);
      usedExistingIndexes.add(existingIndex);
    });
  }

  private getStrictIdentitySignature(activity: ActivityInterface): string | null {
    const startMs = this.toTimestampMs((activity as any)?.startDate);
    if (startMs === null) {
      return null;
    }
    const endMs = this.toTimestampMs((activity as any)?.endDate);
    const type = this.normalizeIdentityType((activity as any)?.type);
    const duration = this.getActivityStatValue(activity, DataDuration.type);
    const distance = this.getActivityStatValue(activity, DataDistance.type);
    const roundedDuration = duration === null ? 'na' : `${Math.round(duration)}`;
    const roundedDistance = distance === null ? 'na' : `${Math.round(distance)}`;
    return [startMs, endMs ?? 'na', type, roundedDuration, roundedDistance].join('|');
  }

  private getTimeTypeIdentitySignature(activity: ActivityInterface): string | null {
    const startMs = this.toTimestampMs((activity as any)?.startDate);
    if (startMs === null) {
      return null;
    }
    const endMs = this.toTimestampMs((activity as any)?.endDate);
    const type = this.normalizeIdentityType((activity as any)?.type);
    return [startMs, endMs ?? 'na', type].join('|');
  }

  private getStartIdentitySignature(activity: ActivityInterface): string | null {
    const startMs = this.toTimestampMs((activity as any)?.startDate);
    if (startMs === null) {
      return null;
    }
    const type = this.normalizeIdentityType((activity as any)?.type);
    return [startMs, type].join('|');
  }

  private getActivityStatValue(activity: ActivityInterface, statType: string): number | null {
    const getter = (activity as any)?.getStat;
    if (typeof getter !== 'function') {
      return null;
    }
    const stat = getter.call(activity, statType);
    const getValue = stat?.getValue;
    if (typeof getValue !== 'function') {
      return null;
    }
    const value = Number(getValue.call(stat));
    return Number.isFinite(value) ? value : null;
  }

  private normalizeIdentityType(type: unknown): string {
    return `${type || ''}`.trim().toLowerCase() || 'unknown';
  }

  private toTimestampMs(value: unknown): number | null {
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number } | null;
    if (maybeTimestamp && typeof maybeTimestamp.toDate === 'function') {
      const date = maybeTimestamp.toDate();
      const timestamp = date?.getTime?.();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (maybeTimestamp && Number.isFinite(maybeTimestamp.seconds)) {
      const nanoseconds = Number.isFinite(maybeTimestamp.nanoseconds) ? maybeTimestamp.nanoseconds || 0 : 0;
      const timestamp = (maybeTimestamp.seconds as number) * 1000 + nanoseconds / 1000000;
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    return null;
  }

  private applyUserActivityOverrides(existingActivity: ActivityInterface, parsedActivity: ActivityInterface): void {
    if (!existingActivity || !parsedActivity) {
      return;
    }

    const existingCreatorName = `${existingActivity.creator?.name ?? ''}`.trim();
    if (existingCreatorName && parsedActivity.creator) {
      parsedActivity.creator.name = existingCreatorName;
    }
  }

  private async fetchAndParseOneFile(
    fileMeta: { path: string; bucket?: string },
    skipEnrichment: boolean = false,
    metadataCacheTtlMs?: number,
    streamTypes?: string[],
  ): Promise<{ event: EventInterface | null; reason?: string }> {
    try {
      const arrayBuffer = metadataCacheTtlMs === undefined
        ? await this.downloadFile(fileMeta.path)
        : await this.downloadFile(fileMeta.path, { metadataCacheTtlMs });
      const extension = this.getNormalizedExtensionFromPath(fileMeta.path);
      const options = createParsingOptions({}, streamTypes);
      let newEvent: EventInterface;

      if (extension === 'fit') {
        newEvent = await EventImporterFIT.getFromArrayBuffer(arrayBuffer, options);
      } else if (extension === 'gpx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterGPX.getFromString(text, null, options);
      } else if (extension === 'tcx') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterTCX.getFromXML((new DOMParser()).parseFromString(text, 'application/xml'), options);
      } else if (extension === 'json') {
        const text = new TextDecoder().decode(arrayBuffer);
        const json = JSON.parse(text);
        const { sanitizedJson } = EventJSONSanitizer.sanitize(json);
        newEvent = await EventImporterSuuntoJSON.getFromJSONString(JSON.stringify(sanitizedJson));
      } else if (extension === 'sml') {
        const text = new TextDecoder().decode(arrayBuffer);
        newEvent = await EventImporterSuuntoSML.getFromXML(text);
      } else {
        return { event: null, reason: `Unsupported original file extension: ${extension}` };
      }

      if (!skipEnrichment) {
        newEvent.getActivities().forEach(activity => {
          try {
            this.appEventUtilities.enrich(activity, ['Time', 'Duration']);
          } catch (e) {
            if ((e as Error)?.message?.includes('Duplicate type of stream')) {
              this.logger.warn('[AppOriginalFileHydrationService] Duplicate stream warning during enrichment', e);
            } else {
              throw e;
            }
          }
        });
      }

      return { event: newEvent };
    } catch (e) {
      this.logger.error('[AppOriginalFileHydrationService] Error parsing original file', fileMeta?.path, e);
      return { event: null, reason: (e as Error)?.message || 'Could not parse file' };
    }
  }

  private getNormalizedExtensionFromPath(path: string): string {
    const parts = path.split('.');
    let extension = parts.pop()?.toLowerCase();
    if (extension === 'gz') {
      extension = parts.pop()?.toLowerCase();
    }
    return extension || '';
  }
}
