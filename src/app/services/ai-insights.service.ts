import { Injectable, inject } from '@angular/core';
import type { AiInsightsRequest, AiInsightsResponse } from '@shared/ai-insights.types';
import { AppFunctionsService } from './app.functions.service';

export type AiInsightsErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'APP_CHECK_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'UNAVAILABLE'
  | 'INTERNAL';

export class AiInsightsError extends Error {
  constructor(
    public readonly code: AiInsightsErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiInsightsError';
  }
}

@Injectable({
  providedIn: 'root',
})
export class AiInsightsService {
  private readonly functionsService = inject(AppFunctionsService);

  async runInsight(request: AiInsightsRequest): Promise<AiInsightsResponse> {
    try {
      const response = await this.functionsService.call<AiInsightsRequest, AiInsightsResponse>('aiInsights', request);
      return response.data;
    } catch (error) {
      throw this.mapFunctionError(error);
    }
  }

  getErrorMessage(error: unknown): string {
    if (error instanceof AiInsightsError) {
      switch (error.code) {
        case 'INVALID_ARGUMENT':
          return 'Try rephrasing the request with a metric, activity type, and time range.';
        case 'UNAUTHENTICATED':
          return 'You need to sign in before using AI Insights.';
        case 'APP_CHECK_REQUIRED':
          return 'App verification failed. Refresh the page and try again.';
        case 'PERMISSION_DENIED':
          return 'AI Insights is available to Basic and Pro members.';
        case 'RESOURCE_EXHAUSTED':
          return 'AI Insights limit reached for this billing period.';
        case 'UNAVAILABLE':
          return 'AI Insights is temporarily unavailable. Please try again in a moment.';
        default:
          return 'Could not generate AI insights.';
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return 'Could not generate AI insights.';
  }

  private mapFunctionError(error: unknown): AiInsightsError {
    const code = `${(error as { code?: unknown })?.code || ''}`;
    const message = `${(error as { message?: unknown })?.message || ''}`.trim();

    if (code.includes('invalid-argument')) {
      return new AiInsightsError('INVALID_ARGUMENT', message || 'Invalid AI insight request.', error);
    }
    if (code.includes('unauthenticated')) {
      return new AiInsightsError('UNAUTHENTICATED', message || 'Authentication required.', error);
    }
    if (code.includes('failed-precondition')) {
      return new AiInsightsError('APP_CHECK_REQUIRED', message || 'App Check verification failed.', error);
    }
    if (code.includes('permission-denied')) {
      return new AiInsightsError('PERMISSION_DENIED', message || 'AI Insights is available to Basic and Pro members.', error);
    }
    if (code.includes('resource-exhausted')) {
      return new AiInsightsError('RESOURCE_EXHAUSTED', message || 'AI Insights limit reached for this billing period.', error);
    }
    if (code.includes('unavailable')) {
      return new AiInsightsError('UNAVAILABLE', message || 'AI Insights is temporarily unavailable.', error);
    }

    return new AiInsightsError('INTERNAL', message || 'Could not generate AI insights.', error);
  }
}
