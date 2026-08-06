import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantChatResponse } from '@shared/assistant.types';
import { AppFunctionsService } from './app.functions.service';
import { AssistantError, AssistantService } from './assistant.service';

const response: AssistantChatResponse = {
  conversation: {
    version: 1,
    conversationId: 'conversation-1',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        text: 'How am I today?',
        createdAt: '2026-08-03T12:00:00.000Z',
      },
      {
        id: 'message-2',
        role: 'assistant',
        text: 'Your readiness is 72 today.',
        createdAt: '2026-08-03T12:00:00.000Z',
        evidence: [],
      },
    ],
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
  pendingRequestId: null,
};
const requestId = 'assistant-request-0001';

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
      requestId,
      message: 'How am I today?',
      timeZone: 'Europe/Helsinki',
    })).resolves.toEqual(response);
    expect(functionsService.call).toHaveBeenCalledWith('assistantChat', {
      requestId,
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
      requestId,
      message: 'How am I today?',
      timeZone: 'UTC',
    })).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('accepts only a pending acknowledgement for the request being sent', async () => {
    functionsService.call.mockResolvedValueOnce({
      data: { ...response, pendingRequestId: requestId },
    });

    await expect(service.sendMessage({
      requestId,
      message: 'How am I today?',
      timeZone: 'UTC',
    })).resolves.toMatchObject({ pendingRequestId: requestId });

    functionsService.call.mockResolvedValueOnce({
      data: { ...response, pendingRequestId: 'assistant-request-different-0001' },
    });
    await expect(service.sendMessage({
      requestId,
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
      requestId,
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
      .mockResolvedValueOnce({
        data: { conversation: response.conversation, pendingRequestId: requestId },
      })
      .mockResolvedValueOnce({ data: { conversation: response.conversation } });

    await expect(service.getConversation()).resolves.toEqual(response.conversation);
    await expect(service.resetConversation()).resolves.toEqual(response.conversation);
    expect(functionsService.call).toHaveBeenNthCalledWith(1, 'getAssistantConversation');
    expect(functionsService.call).toHaveBeenNthCalledWith(2, 'resetAssistantConversation');
  });

  it('cleans legacy storage-unit suffixes from saved evidence labels', async () => {
    const conversation = {
      ...response.conversation,
      messages: response.conversation.messages.map(message => (
        message.role === 'assistant'
          ? {
            ...message,
            evidence: [{
              toolName: 'get_daily_report',
              title: 'Get daily health and training report',
              summary: 'Grounded in the daily report.',
              facts: [
                { label: 'Start Time Ms', value: '2026-08-03T20:26:00.000Z' },
                { label: 'End Time', value: '2026-08-04T06:15:00.000Z' },
                { label: 'Duration Seconds', value: '9h 18m' },
                { label: 'Recovery Time Seconds', value: '3600' },
              ],
              links: [],
            }],
          }
          : message
      )),
    };
    functionsService.call.mockResolvedValue({
      data: { conversation, pendingRequestId: null },
    });

    const loaded = await service.getConversation();
    const formatTimestamp = (value: string): string => new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

    expect(loaded?.messages[1].evidence?.[0].facts).toEqual([
      {
        label: 'Start Time',
        value: formatTimestamp('2026-08-03T20:26:00.000Z'),
      },
      {
        label: 'End Time',
        value: formatTimestamp('2026-08-04T06:15:00.000Z'),
      },
      { label: 'Duration', value: '9h 18m' },
      { label: 'Recovery Time Seconds', value: '3600' },
    ]);
  });

  it('loads and validates an active pending request identity', async () => {
    functionsService.call.mockResolvedValue({
      data: {
        conversation: response.conversation,
        pendingRequestId: requestId,
      },
    });

    await expect(service.getConversationState()).resolves.toEqual({
      conversation: response.conversation,
      pendingRequestId: requestId,
    });

    functionsService.call.mockResolvedValue({
      data: {
        conversation: response.conversation,
        pendingRequestId: 'unsafe request id',
      },
    });
    await expect(service.getConversationState())
      .rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('accepts a conversation response from before pending recovery was deployed', async () => {
    functionsService.call.mockResolvedValue({
      data: { conversation: response.conversation },
    });

    await expect(service.getConversationState()).resolves.toEqual({
      conversation: response.conversation,
      pendingRequestId: null,
    });
  });
});
