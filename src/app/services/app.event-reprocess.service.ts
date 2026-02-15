import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActivityUtilities, EventUtilities, User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '../../../functions/src/shared/app-event.interface';
import { AppEventService } from './app.event.service';
import { AppOriginalFileHydrationService } from './app.original-file-hydration.service';

export type ReprocessPhase =
  | 'validating'
  | 'downloading'
  | 'parsing'
  | 'merging'
  | 'regenerating_stats'
  | 'persisting'
  | 'done';

export interface ReprocessProgress {
  phase: ReprocessPhase;
  progress: number;
  details?: string;
}

export interface ReprocessOptions {
  onProgress?: (progress: ReprocessProgress) => void;
  skipEnrichment?: boolean;
}

export interface ReprocessResult {
  event: AppEventInterface;
  updatedActivityId?: string;
  sourceFilesCount: number;
  wasMultiFileSource: boolean;
  preservedIsMerge: boolean;
}

export type ReprocessErrorCode =
  | 'NO_ORIGINAL_FILES'
  | 'PARSE_FAILED'
  | 'MULTI_FILE_INCOMPLETE'
  | 'ACTIVITY_NOT_FOUND_AFTER_REHYDRATE'
  | 'PERSIST_FAILED';

export class ReprocessError extends Error {
  constructor(
    public code: ReprocessErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'ReprocessError';
  }
}

@Injectable({
  providedIn: 'root'
})
export class AppEventReprocessService {
  private eventService = inject(AppEventService);
  private originalFileHydrationService = inject(AppOriginalFileHydrationService);

  public async regenerateEventStatistics(
    user: User,
    event: AppEventInterface,
    options?: ReprocessOptions,
  ): Promise<ReprocessResult> {
    this.notifyProgress(options, { phase: 'validating', progress: 5, details: 'Validating source files' });
    const sourceFilesCount = this.getSourceFileCount(event);
    if (sourceFilesCount === 0) {
      throw new ReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this event.');
    }

    try {
      this.notifyProgress(options, { phase: 'downloading', progress: 20, details: 'Loading source files' });
      this.notifyProgress(options, { phase: 'parsing', progress: 40, details: 'Parsing activities' });
      await firstValueFrom(
        this.eventService.attachStreamsToEventWithActivities(
          user,
          event,
          undefined,
          true,
          options?.skipEnrichment === true,
          'replace_activities',
        ),
      );
    } catch (e) {
      throw new ReprocessError('PARSE_FAILED', 'Could not parse original source file(s).', e);
    }

    this.notifyProgress(options, { phase: 'regenerating_stats', progress: 65, details: 'Re-generating activity statistics' });
    event.getActivities().forEach(activity => {
      const previousStats = new Map(activity.getStats());
      activity.clearStats();
      ActivityUtilities.generateMissingStreamsAndStatsForActivity(activity);
      previousStats.forEach((stat, type) => {
        if (!activity.getStat(type)) {
          activity.addStat(stat);
        }
      });
    });

    EventUtilities.reGenerateStatsForEvent(event);

    this.notifyProgress(options, { phase: 'persisting', progress: 90, details: 'Saving updated event' });
    try {
      await this.eventService.writeAllEventData(user, event);
    } catch (e) {
      throw new ReprocessError('PERSIST_FAILED', 'Could not persist re-generated event data.', e);
    }

    this.notifyProgress(options, { phase: 'done', progress: 100, details: 'Done' });
    return {
      event,
      sourceFilesCount,
      wasMultiFileSource: sourceFilesCount > 1,
      preservedIsMerge: !!(event as any).isMerge,
    };
  }

  public async regenerateActivityStatistics(
    user: User,
    event: AppEventInterface,
    activityId: string,
    options?: ReprocessOptions,
  ): Promise<ReprocessResult> {
    this.notifyProgress(options, { phase: 'validating', progress: 5, details: 'Validating source files' });
    const sourceFilesCount = this.getSourceFileCount(event);
    if (sourceFilesCount === 0) {
      throw new ReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this event.');
    }

    try {
      this.notifyProgress(options, { phase: 'downloading', progress: 20, details: 'Loading source files' });
      this.notifyProgress(options, { phase: 'parsing', progress: 40, details: 'Parsing activities' });
      await firstValueFrom(
        this.eventService.attachStreamsToEventWithActivities(
          user,
          event,
          undefined,
          true,
          options?.skipEnrichment === true,
          'replace_activities',
        ),
      );
    } catch (e) {
      throw new ReprocessError('PARSE_FAILED', 'Could not parse original source file(s).', e);
    }

    const updatedActivity = event.getActivities().find(activity => activity.getID() === activityId);
    if (!updatedActivity) {
      throw new ReprocessError(
        'ACTIVITY_NOT_FOUND_AFTER_REHYDRATE',
        `Activity ${activityId} was not found after rehydrating source files.`,
      );
    }

    this.notifyProgress(options, { phase: 'regenerating_stats', progress: 70, details: 'Re-generating event statistics' });
    EventUtilities.reGenerateStatsForEvent(event);

    this.notifyProgress(options, { phase: 'persisting', progress: 90, details: 'Saving updated event' });
    try {
      await this.eventService.writeAllEventData(user, event);
    } catch (e) {
      throw new ReprocessError('PERSIST_FAILED', 'Could not persist re-generated event data.', e);
    }

    this.notifyProgress(options, { phase: 'done', progress: 100, details: 'Done' });
    return {
      event,
      updatedActivityId: updatedActivity.getID(),
      sourceFilesCount,
      wasMultiFileSource: sourceFilesCount > 1,
      preservedIsMerge: !!(event as any).isMerge,
    };
  }

  public async reimportEventFromOriginalFiles(
    user: User,
    event: AppEventInterface,
    options?: ReprocessOptions,
  ): Promise<ReprocessResult> {
    this.notifyProgress(options, { phase: 'validating', progress: 5, details: 'Validating source files' });
    const sourceFilesCount = this.getSourceFileCount(event);
    if (sourceFilesCount === 0) {
      throw new ReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this event.');
    }

    const originalIsMerge = !!(event as any).isMerge;
    const eventAny = event as any;
    const originalFiles = eventAny.originalFiles;
    const originalFile = eventAny.originalFile;
    this.notifyProgress(options, { phase: 'downloading', progress: 20, details: 'Downloading source files' });
    this.notifyProgress(options, { phase: 'parsing', progress: 40, details: 'Parsing source files' });
    const parseResult = await this.originalFileHydrationService.parseEventFromOriginalFiles(event, {
      skipEnrichment: options?.skipEnrichment === true,
      strictAllFilesRequired: true,
      preserveActivityIdsFromEvent: true,
      mergeMultipleFiles: true,
    });

    if (parseResult.failedFiles.length > 0) {
      const details = parseResult.failedFiles.map(file => `${file.path}: ${file.reason}`).join('; ');
      throw new ReprocessError('MULTI_FILE_INCOMPLETE', `Reimport aborted because one or more source files failed to parse. ${details}`);
    }

    if (!parseResult.finalEvent) {
      throw new ReprocessError('PARSE_FAILED', 'Could not parse original source file(s).');
    }

    this.notifyProgress(options, { phase: 'merging', progress: 60, details: 'Preparing reimported event data' });
    const reimportedEvent = parseResult.finalEvent as AppEventInterface;
    reimportedEvent.setID(event.getID());
    (reimportedEvent as any).isMerge = originalIsMerge;
    (reimportedEvent as any).originalFiles = originalFiles;
    (reimportedEvent as any).originalFile = originalFile;

    this.notifyProgress(options, { phase: 'regenerating_stats', progress: 75, details: 'Re-building event statistics' });
    EventUtilities.reGenerateStatsForEvent(reimportedEvent);

    this.notifyProgress(options, { phase: 'persisting', progress: 90, details: 'Saving reimported event' });
    try {
      await this.eventService.writeAllEventData(user, reimportedEvent);
    } catch (e) {
      throw new ReprocessError('PERSIST_FAILED', 'Could not persist reimported event data.', e);
    }

    event.clearActivities();
    event.addActivities(reimportedEvent.getActivities());
    (event as any).isMerge = originalIsMerge;
    EventUtilities.reGenerateStatsForEvent(event);

    this.notifyProgress(options, { phase: 'done', progress: 100, details: 'Done' });
    return {
      event,
      sourceFilesCount: parseResult.sourceFilesCount,
      wasMultiFileSource: parseResult.sourceFilesCount > 1,
      preservedIsMerge: originalIsMerge,
    };
  }

  private notifyProgress(options: ReprocessOptions | undefined, progress: ReprocessProgress): void {
    options?.onProgress?.(progress);
  }

  private getSourceFileCount(event: AppEventInterface): number {
    if (event.originalFiles && event.originalFiles.length > 0) {
      return event.originalFiles.length;
    }
    return event.originalFile?.path ? 1 : 0;
  }
}
