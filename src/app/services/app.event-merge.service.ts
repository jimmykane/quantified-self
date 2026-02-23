import { Injectable, inject } from '@angular/core';

import { AppFunctionsService } from './app.functions.service';

export type MergeType = 'benchmark' | 'multi';

export interface MergeEventResponse {
  eventId: string;
  mergeType: MergeType;
  sourceEventsCount: number;
  sourceFilesCount: number;
  activitiesCount: number;
  uploadLimit: number | null;
  uploadCountAfterWrite: number | null;
}

export type EventMergeErrorCode =
  | 'INVALID_ARGUMENT'
  | 'LIMIT_REACHED'
  | 'EVENT_NOT_FOUND'
  | 'MISSING_SOURCE_FILE'
  | 'INTERNAL';

export class EventMergeError extends Error {
  constructor(
    public readonly code: EventMergeErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EventMergeError';
  }
}

@Injectable({
  providedIn: 'root',
})
export class AppEventMergeService {
  private functionsService = inject(AppFunctionsService);

  public async mergeEvents(eventIds: string[], mergeType: MergeType): Promise<MergeEventResponse> {
    try {
      const response = await this.functionsService.call<
        { eventIds: string[]; mergeType: MergeType },
        MergeEventResponse
      >('mergeEvents', { eventIds, mergeType });
      return response.data;
    } catch (error) {
      throw this.mapFunctionError(error);
    }
  }

  public getMergeErrorMessage(error: unknown): string {
    if (error instanceof EventMergeError) {
      switch (error.code) {
        case 'INVALID_ARGUMENT':
          return 'Could not merge events because the selection is invalid.';
        case 'LIMIT_REACHED':
          return 'Upload limit reached for your tier.';
        case 'EVENT_NOT_FOUND':
          return 'One or more selected events were not found.';
        case 'MISSING_SOURCE_FILE':
          return 'One or more selected events have missing original files.';
        default:
          return 'Could not merge events.';
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'Could not merge events.';
  }

  private mapFunctionError(error: unknown): EventMergeError {
    const code = `${(error as { code?: unknown })?.code || ''}`;
    const message = `${(error as { message?: unknown })?.message || ''}`;

    if (code.includes('invalid-argument')) {
      return new EventMergeError('INVALID_ARGUMENT', message || 'Invalid merge request.', error);
    }
    if (code.includes('resource-exhausted')) {
      return new EventMergeError('LIMIT_REACHED', message || 'Upload limit reached.', error);
    }
    if (code.includes('not-found')) {
      return new EventMergeError('EVENT_NOT_FOUND', message || 'Selected events were not found.', error);
    }
    if (code.includes('failed-precondition')) {
      return new EventMergeError('MISSING_SOURCE_FILE', message || 'Missing source files.', error);
    }

    return new EventMergeError('INTERNAL', message || 'Could not merge events.', error);
  }
}
