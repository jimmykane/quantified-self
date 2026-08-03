import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantChatResponse } from '@shared/assistant.types';
import { AppFunctionsService } from './app.functions.service';
import { AssistantError, AssistantService } from './assistant.service';

const response: AssistantChatResponse = {
  conversation: {
    version: 1,
    conversationId: 'conversation-1',
    messages: [{
      id: 'message-1',
      role: 'assistant',
      text: 'Your readiness is 72 today.',
      createdAt: '2026-08-03T12:00:00.000Z',
      evidence: [],
    }],
    expiresAt: '2026-08-10T12:00:00.000Z',
  },
  quota: {
    role: 'free',
    limit: 20,
    successfulRequestCount: 1,
    activeRequestCount: 0,
    remainingCount: 19,
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    periodKind: 'calendar_month',
    resetMode: 'date',
    isEligible: true,
    blockedReason: null,
  },
};

describe('AssistantService', () => {
  const functionsService = { call: vi.fn() };
  let service: AssistantService;

  beforeEach(() => {
    functionsService.call.mockReset();
    TestBed.configureTestingModule({
      providers: [
        AssistantService,
        { provide: AppFunctionsService, useValue: functionsService },
      ],
    });
    service = TestBed.inject(AssistantService);
  });

  it('calls the Assistant callable and validates its response', async () => {
    functionsService.call.mockResolvedValue({ data: response });

    await expect(service.sendMessage({
      message: 'How am I today?',
      timeZone: 'Europe/Helsinki',
    })).resolves.toEqual(response);
    expect(functionsService.call).toHaveBeenCalledWith('assistantChat', {
      message: 'How am I today?',
      timeZone: 'Europe/Helsinki',
    });
  });

  it('rejects malformed conversation payloads', async () => {
    functionsService.call.mockResolvedValue({
      data: {
        ...response,
        conversation: {
          ...response.conversation,
          messages: [{ role: 'assistant', text: '' }],
        },
      },
    });

    await expect(service.sendMessage({
      message: 'How am I today?',
      timeZone: 'UTC',
    })).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('maps concurrent conversation failures without presenting them as quota errors', async () => {
    functionsService.call.mockRejectedValue({
      code: 'functions/aborted',
      message: 'Another Assistant response is still in progress.',
      details: { reason: 'turn_in_progress' },
    });

    await expect(service.sendMessage({
      message: 'How am I today?',
      timeZone: 'UTC',
    })).rejects.toMatchObject({ code: 'TURN_IN_PROGRESS' });
    expect(service.getErrorMessage(new AssistantError(
      'TURN_IN_PROGRESS',
      'Another Assistant response is still in progress.',
    ))).toContain('still in progress');
  });

  it('loads and resets the server-owned active conversation', async () => {
    functionsService.call
      .mockResolvedValueOnce({ data: { conversation: response.conversation } })
      .mockResolvedValueOnce({ data: { conversation: response.conversation } });

    await expect(service.getConversation()).resolves.toEqual(response.conversation);
    await expect(service.resetConversation()).resolves.toEqual(response.conversation);
    expect(functionsService.call).toHaveBeenNthCalledWith(1, 'getAssistantConversation');
    expect(functionsService.call).toHaveBeenNthCalledWith(2, 'resetAssistantConversation');
  });
});
