import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  ActivityParsingOptions,
  EventImporterFIT,
  EventImporterGPX,
  EventImporterSuuntoJSON,
  EventImporterSuuntoSML,
  EventImporterTCX,
  EventInterface,
  EventUtilities,
} from '@sports-alliance/sports-lib';
import { Storage, getBytes, getMetadata, ref } from '@angular/fire/storage';
import { AppFileService } from './app.file.service';
import { LoggerService } from './logger.service';
import { AppEventUtilities } from '../utils/app.event.utilities';
import { AppCacheService } from './app.cache.service';
import { EventJSONSanitizer } from '../utils/event-json-sanitizer';
import { AppEventInterface, OriginalFileMetaData } from '../../../functions/src/shared/app-event.interface';
import { ActivityInterface } from '@sports-alliance/sports-lib';

export interface ParseOptions {
  skipEnrichment?: boolean;
  strictAllFilesRequired?: boolean;
  preserveActivityIdsFromEvent?: boolean;
  mergeMultipleFiles?: boolean;
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

@Injectable({
  providedIn: 'root'
})
export class AppOriginalFileHydrationService {
  private storage = inject(Storage);
  private injector = inject(Injector);
  private fileService = inject(AppFileService);
  private logger = inject(LoggerService);
  private appEventUtilities = inject(AppEventUtilities);
  private cacheService = inject(AppCacheService);

  public async downloadFile(path: string): Promise<ArrayBuffer> {
    const fileRef = runInInjectionContext(this.injector, () => ref(this.storage, path));

    try {
      const metadata = await runInInjectionContext(this.injector, () => getMetadata(fileRef));
      const generation = metadata.generation;
      const cached = await this.cacheService.getFile(path);

      if (cached && cached.generation === generation) {
        this.logger.log(`[AppOriginalFileHydrationService] Cache HIT for ${path}`);
        return this.fileService.decompressIfNeeded(cached.buffer, path);
      }

      this.logger.log(`[AppOriginalFileHydrationService] Cache MISS/STALE for ${path} (Cloud Gen: ${generation}, Cached Gen: ${cached?.generation})`);
      const buffer = await runInInjectionContext(this.injector, () => getBytes(fileRef));
      await this.cacheService.setFile(path, { buffer, generation });
      return this.fileService.decompressIfNeeded(buffer, path);
    } catch (e) {
      this.logger.error(`[AppOriginalFileHydrationService] Error downloading/caching file ${path}`, e);
      const buffer = await runInInjectionContext(this.injector, () => getBytes(fileRef));
      return this.fileService.decompressIfNeeded(buffer, path);
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
      const result = await this.fetchAndParseOneFile(sourceFile, options.skipEnrichment === true);
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
    const existingActivities = existingEvent.getActivities();
    parsedEvent.getActivities().forEach((parsedActivity, index) => {
      const existingActivity = existingActivities[index];
      if (!existingActivity) {
        return;
      }

      const existingId = existingActivity.getID();
      if (existingId) {
        parsedActivity.setID(existingId);
      }
      this.applyUserActivityOverrides(existingActivity, parsedActivity);
    });
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
  ): Promise<{ event: EventInterface | null; reason?: string }> {
    try {
      const arrayBuffer = await this.downloadFile(fileMeta.path);
      const extension = this.getNormalizedExtensionFromPath(fileMeta.path);
      const options = new ActivityParsingOptions({
        generateUnitStreams: false,
        deviceInfoMode: 'changes',
      });
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
