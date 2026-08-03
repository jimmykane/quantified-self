import { describe, expect, it } from 'vitest';
import type { AssistantChatResponse } from '@shared/assistant.types';
import {
  validateAssistantChatResponse,
  validateAssistantConversation,
} from '@shared/assistant-response.contract';

function buildResponse(): AssistantChatResponse {
  return {
    conversation: {
      version: 1,
      conversationId: 'conversation-1',
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        text: 'Your readiness is 72 today.',
        createdAt: '2026-08-03T12:00:00.000Z',
        evidence: [{
          toolName: 'get_daily_report',
          title: 'Get daily report',
          summary: 'Grounded in the daily report.',
          facts: [{ label: 'Readiness', value: '72' }],
          links: [{
            label: 'Open in Quantified Self',
            url: 'https://quantified-self.io/user/me/event/activity',
          }],
        }],
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
}

describe('Assistant response contract', () => {
  it('accepts a complete bounded response', () => {
    expect(validateAssistantChatResponse(buildResponse()).ok).toBe(true);
  });

  it('rejects stored user messages beyond the request limit', () => {
    const response = buildResponse();
    response.conversation.messages = [{
      id: 'user-1',
      role: 'user',
      text: 'x'.repeat(1_001),
      createdAt: '2026-08-03T12:00:00.000Z',
    }];

    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_messages',
    });
  });

  it('rejects evidence links outside the HTTPS Quantified Self hosts', () => {
    const response = buildResponse();
    response.conversation.messages[0].evidence![0].links[0].url =
      'https://attacker.example/redirect';

    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_messages',
    });
  });

  it('rejects malformed quota counters', () => {
    const response = buildResponse();
    response.quota.remainingCount = -1;

    expect(validateAssistantChatResponse(response)).toMatchObject({
      ok: false,
      reason: 'invalid_quota',
    });
  });

  it('rejects date-like strings that are not canonical UTC timestamps', () => {
    const response = buildResponse();
    response.conversation.expiresAt = '2026-08-10';

    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_expiry',
    });
  });
});
