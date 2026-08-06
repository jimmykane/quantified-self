import { Injectable, inject } from '@angular/core';
import {
  isValidAssistantRequestId,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type AssistantConversation,
  type GetAssistantConversationResponse,
  type ResetAssistantConversationResponse,
} from '@shared/assistant.types';
import {
  validateAssistantChatResponse,
  validateAssistantConversation,
} from '@shared/assistant-response.contract';
import { normalizeAssistantConversationEvidence } from '@shared/assistant-evidence-display';
import { AppFunctionsService } from './app.functions.service';

export type AssistantErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'APP_CHECK_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'TURN_IN_PROGRESS'
  | 'CONVERSATION_CHANGED'
  | 'UNAVAILABLE'
  | 'INTERNAL';

export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AssistantError';
  }
}

@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly functionsService = inject(AppFunctionsService);

  async sendMessage(request: AssistantChatRequest): Promise<AssistantChatResponse> {
    try {
      const response = await this.functionsService.call<AssistantChatRequest, AssistantChatResponse>(
        'assistantChat',
        request,
      );
      const validation = validateAssistantChatResponse(response.data);
      if (validation.ok === false) {
        throw new AssistantError(
          'INTERNAL',
          `The Assistant returned an invalid response (${validation.reason}).`,
          validation,
        );
      }
      return {
        ...validation.data,
        conversation: normalizeAssistantConversationEvidence(validation.data.conversation),
      };
    } catch (error) {
      if (error instanceof AssistantError) {
        throw error;
      }
      throw this.mapFunctionError(error);
    }
  }

  async getConversation(): Promise<AssistantConversation | null> {
    return (await this.getConversationState()).conversation;
  }

  async getConversationState(): Promise<GetAssistantConversationResponse> {
    try {
      const response = await this.functionsService.call<void, GetAssistantConversationResponse>(
        'getAssistantConversation',
      );
      const pendingRequestId = (
        response.data as Partial<GetAssistantConversationResponse>
      ).pendingRequestId ?? null;
      if (pendingRequestId !== null
        && !isValidAssistantRequestId(pendingRequestId)) {
        throw new AssistantError(
          'INTERNAL',
          'The saved Assistant pending request is invalid.',
          response.data,
        );
      }
      if (response.data.conversation === null) {
        return { conversation: null, pendingRequestId };
      }
      const validation = validateAssistantConversation(response.data.conversation);
      if (validation.ok === false) {
        throw new AssistantError(
          'INTERNAL',
          `The saved Assistant conversation is invalid (${validation.reason}).`,
          validation,
        );
      }
      return {
        conversation: normalizeAssistantConversationEvidence(validation.data),
        pendingRequestId,
      };
    } catch (error) {
      if (error instanceof AssistantError) {
        throw error;
      }
      throw this.mapFunctionError(error);
    }
  }

  async resetConversation(): Promise<AssistantConversation> {
    try {
      const response = await this.functionsService.call<void, ResetAssistantConversationResponse>(
        'resetAssistantConversation',
      );
      const validation = validateAssistantConversation(response.data.conversation);
      if (validation.ok === false) {
        throw new AssistantError(
          'INTERNAL',
          `The Assistant returned an invalid reset response (${validation.reason}).`,
          validation,
        );
      }
      return normalizeAssistantConversationEvidence(validation.data);
    } catch (error) {
      if (error instanceof AssistantError) {
        throw error;
      }
      throw this.mapFunctionError(error);
    }
  }

  getErrorMessage(error: unknown): string {
    if (!(error instanceof AssistantError)) {
      return 'The Assistant could not answer right now. Please try again.';
    }
    switch (error.code) {
      case 'INVALID_ARGUMENT':
        return 'Check your message and try again.';
      case 'UNAUTHENTICATED':
        return 'Sign in before using the Assistant.';
      case 'APP_CHECK_REQUIRED':
        return 'App verification failed. Refresh the page and try again.';
      case 'PERMISSION_DENIED':
        return 'The Assistant is unavailable for this account.';
      case 'RESOURCE_EXHAUSTED':
        return 'Your Assistant allowance is used for this period. You can still connect your own AI client through MCP.';
      case 'TURN_IN_PROGRESS':
        return 'Another Assistant response is still in progress. Wait for it to finish and try again.';
      case 'CONVERSATION_CHANGED':
        return 'The conversation changed in another tab. Reload it and try again.';
      case 'UNAVAILABLE':
        return 'The Assistant could not answer right now. Please try again.';
      default:
        return 'Something went wrong while preparing the answer.';
    }
  }

  private mapFunctionError(error: unknown): AssistantError {
    const code = `${(error as { code?: unknown } | null)?.code || ''}`;
    const message = `${(error as { message?: unknown } | null)?.message || ''}`.trim();
    if (code.includes('invalid-argument')) {
      return new AssistantError('INVALID_ARGUMENT', message || 'Invalid Assistant request.', error);
    }
    if (code.includes('unauthenticated')) {
      return new AssistantError('UNAUTHENTICATED', message || 'Authentication required.', error);
    }
    if (code.includes('failed-precondition')) {
      return new AssistantError('APP_CHECK_REQUIRED', message || 'App verification failed.', error);
    }
    if (code.includes('permission-denied')) {
      return new AssistantError('PERMISSION_DENIED', message || 'Assistant access denied.', error);
    }
    if (code.includes('resource-exhausted')) {
      return new AssistantError('RESOURCE_EXHAUSTED', message || 'Assistant allowance exhausted.', error);
    }
    if (code.includes('aborted')) {
      const reason = `${(error as { details?: { reason?: unknown } } | null)?.details?.reason || ''}`;
      if (reason === 'turn_in_progress' || /still in progress/i.test(message)) {
        return new AssistantError('TURN_IN_PROGRESS', message || 'Assistant response in progress.', error);
      }
      return new AssistantError('CONVERSATION_CHANGED', message || 'Conversation changed.', error);
    }
    if (code.includes('unavailable')) {
      return new AssistantError('UNAVAILABLE', message || 'Assistant unavailable.', error);
    }
    return new AssistantError('INTERNAL', message || 'Assistant request failed.', error);
  }
}
