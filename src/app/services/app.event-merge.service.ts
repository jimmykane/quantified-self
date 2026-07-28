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
  | 'DUPLICATE_SOURCE_FILE'
  | 'OUTCOME_UNKNOWN'
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
  private readonly reconciliationRetryDelaysMs = [750, 2000];

  public async mergeEvents(eventIds: string[], mergeType: MergeType): Promise<MergeEventResponse> {
    for (let attempt = 0; attempt <= this.reconciliationRetryDelaysMs.length; attempt++) {
      try {
        const response = await this.functionsService.call<
          { eventIds: string[]; mergeType: MergeType },
          MergeEventResponse
        >('mergeEvents', { eventIds, mergeType });
        return response.data;
      } catch (error) {
        if (!this.isAmbiguousMergeOutcome(error)) {
          throw this.mapFunctionError(error);
        }
        if (attempt === this.reconciliationRetryDelaysMs.length) {
          throw new EventMergeError(
            'OUTCOME_UNKNOWN',
            'The merge result could not be confirmed after retrying.',
            error,
          );
        }
        await this.waitBeforeRetry(this.reconciliationRetryDelaysMs[attempt]);
      }
    }

    throw new EventMergeError('OUTCOME_UNKNOWN', 'The merge result could not be confirmed.');
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
        case 'DUPLICATE_SOURCE_FILE':
          return 'Selected events include identical source files. Deselect duplicates and try again.';
        case 'OUTCOME_UNKNOWN':
          return 'The merge may still be finishing. Refresh the event list, then retry the same selection; an existing result will be reused.';
        default:
          return 'Could not merge events.';
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'Could not merge events.';
  }

  private isAmbiguousMergeOutcome(error: unknown): boolean {
    const rawCode = `${(error as { code?: unknown } | null)?.code || ''}`.toLowerCase();
    const normalizedCode = rawCode.replace(/^functions\//u, '');
    if ([
      'aborted',
      'cancelled',
      'deadline-exceeded',
      'internal',
      'unavailable',
      'unknown',
    ].includes(normalizedCode)) {
      return true;
    }

    const message = `${(error as { message?: unknown } | null)?.message || ''}`;
    return /\b50[234]\b|bad gateway|service unavailable|gateway timeout|timed? out|failed to fetch|network(?: request)? failed|network ?error|load failed|connection (?:reset|closed)/iu
      .test(message);
  }

  private async waitBeforeRetry(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
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
    if (code.includes('already-exists')) {
      return new EventMergeError(
        'DUPLICATE_SOURCE_FILE',
        message || 'Selected events include identical source files.',
        error,
      );
    }

    return new EventMergeError('INTERNAL', message || 'Could not merge events.', error);
  }
}
