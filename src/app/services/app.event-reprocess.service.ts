import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { EventUtilities, User } from '@sports-alliance/sports-lib';
import { AppEventInterface } from '@shared/app-event.interface';
import { AppEventService } from './app.event.service';
import { AppFunctionsService } from './app.functions.service';

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
  sourceFilesCount: number;
  wasMultiFileSource: boolean;
  preservedIsMerge: boolean;
}

export type ReprocessErrorCode =
  | 'NO_ORIGINAL_FILES'
  | 'PARSE_FAILED'
  | 'MULTI_FILE_INCOMPLETE'
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

type ReprocessMode = 'reimport' | 'regenerate';

interface ReprocessEventFunctionResponse {
  eventId: string;
  mode: ReprocessMode;
  status: 'completed' | 'skipped';
  reason?: string;
  sourceFilesCount: number;
  parsedActivitiesCount: number;
  staleActivitiesDeleted: number;
}

@Injectable({
  providedIn: 'root'
})
export class AppEventReprocessService {
  private eventService = inject(AppEventService);
  private functionsService = inject(AppFunctionsService);

  public async regenerateEventStatistics(
    user: User,
    event: AppEventInterface,
    options?: ReprocessOptions,
  ): Promise<ReprocessResult> {
    return this.executeReprocess(user, event, 'regenerate', options);
  }

  public async reimportEventFromOriginalFiles(
    user: User,
    event: AppEventInterface,
    options?: ReprocessOptions,
  ): Promise<ReprocessResult> {
    return this.executeReprocess(user, event, 'reimport', options);
  }

  private async executeReprocess(
    user: User,
    event: AppEventInterface,
    mode: ReprocessMode,
    options?: ReprocessOptions,
  ): Promise<ReprocessResult> {
    const eventID = event.getID();
    if (!eventID) {
      throw new ReprocessError('PARSE_FAILED', 'Event ID is missing and cannot be reprocessed.');
    }

    const phases = this.getProgressPlan(mode);
    phases.forEach(progress => this.notifyProgress(options, progress));

    let functionResult: ReprocessEventFunctionResponse;
    try {
      const response = await this.functionsService.call<
        { eventId: string; mode: ReprocessMode },
        ReprocessEventFunctionResponse
      >('reprocessEvent', { eventId: eventID, mode });
      functionResult = response.data;
    } catch (error) {
      throw this.mapFunctionError(mode, error);
    }

    if (functionResult.status === 'skipped' && functionResult.reason === 'NO_ORIGINAL_FILES') {
      throw new ReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this event.');
    }

    const refreshedEvent = await firstValueFrom(this.eventService.getEventAndActivities(user, eventID));
    if (!refreshedEvent) {
      throw new ReprocessError('PERSIST_FAILED', 'Could not load updated event after reprocessing.');
    }

    this.syncEventReference(event, refreshedEvent);
    this.notifyProgress(options, { phase: 'done', progress: 100, details: 'Done' });

    return {
      event,
      sourceFilesCount: functionResult.sourceFilesCount,
      wasMultiFileSource: functionResult.sourceFilesCount > 1,
      preservedIsMerge: !!(event as any).isMerge,
    };
  }

  private syncEventReference(targetEvent: AppEventInterface, sourceEvent: AppEventInterface): void {
    targetEvent.clearActivities();
    targetEvent.addActivities(sourceEvent.getActivities());

    const targetAny = targetEvent as any;
    const sourceAny = sourceEvent as any;
    targetAny.originalFiles = sourceAny.originalFiles;
    targetAny.originalFile = sourceAny.originalFile;
    targetAny.isMerge = sourceAny.isMerge;

    EventUtilities.reGenerateStatsForEvent(targetEvent);
  }

  private mapFunctionError(mode: ReprocessMode, error: unknown): ReprocessError {
    const message = error instanceof Error ? error.message : `${error}`;
    if (message.includes('NO_ORIGINAL_FILES')) {
      return new ReprocessError('NO_ORIGINAL_FILES', 'No original source file metadata found for this event.', error);
    }

    if (mode === 'reimport') {
      return new ReprocessError('MULTI_FILE_INCOMPLETE', 'Reimport failed because source files could not be processed.', error);
    }

    return new ReprocessError('PARSE_FAILED', 'Could not parse original source file(s).', error);
  }

  private notifyProgress(options: ReprocessOptions | undefined, progress: ReprocessProgress): void {
    options?.onProgress?.(progress);
  }

  private getProgressPlan(mode: ReprocessMode): ReprocessProgress[] {
    if (mode === 'reimport') {
      return [
        { phase: 'validating', progress: 5, details: 'Validating source files' },
        { phase: 'downloading', progress: 20, details: 'Downloading source files' },
        { phase: 'parsing', progress: 40, details: 'Parsing source files' },
        { phase: 'merging', progress: 60, details: 'Merging parsed activities' },
        { phase: 'regenerating_stats', progress: 75, details: 'Re-generating event statistics' },
        { phase: 'persisting', progress: 90, details: 'Saving updated event' },
      ];
    }

    return [
      { phase: 'validating', progress: 5, details: 'Validating source files' },
      { phase: 'downloading', progress: 20, details: 'Loading source files' },
      { phase: 'parsing', progress: 40, details: 'Parsing activities' },
      { phase: 'regenerating_stats', progress: 70, details: 'Re-generating event statistics' },
      { phase: 'persisting', progress: 90, details: 'Saving updated event' },
    ];
  }
}
