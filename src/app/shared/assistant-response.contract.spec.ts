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
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'How am I today?',
          createdAt: '2026-08-03T12:00:00.000Z',
        },
        {
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
          visuals: [{
            kind: 'chart',
            title: 'Sleep and recovery trend',
            chartType: 'line',
            xAxis: {
              type: 'time',
              label: 'Date',
              unit: null,
              timeZone: 'Europe/Helsinki',
            },
            series: [{
              label: 'Overnight HRV',
              unit: 'ms',
              points: [
                { x: '2026-08-02T00:00:00.000Z', y: 52 },
                { x: '2026-08-03T00:00:00.000Z', y: null },
              ],
            }],
          }, {
            kind: 'map',
            title: 'Activity location',
            style: 'user_preference',
            markers: [{
              kind: 'start',
              label: 'Start',
              latitudeDegrees: 39.665,
              longitudeDegrees: 20.853,
            }],
            path: [],
          }],
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
}

describe('Assistant response contract', () => {
  it('accepts a complete bounded response', () => {
    expect(validateAssistantChatResponse(buildResponse()).ok).toBe(true);
  });

  it('keeps existing satellite map replies readable', () => {
    const response = buildResponse();
    const visual = response.conversation.messages[1].visuals?.[1];
    if (visual?.kind === 'map') {
      visual.style = 'satellite';
    }

    expect(validateAssistantChatResponse(response).ok).toBe(true);
  });

  it('accepts a valid pending request identity and rejects missing or malformed state', () => {
    const pending = buildResponse();
    pending.pendingRequestId = 'assistant-request-pending-0001';
    expect(validateAssistantChatResponse(pending).ok).toBe(true);

    const missing = buildResponse() as unknown as Record<string, unknown>;
    delete missing.pendingRequestId;
    expect(validateAssistantChatResponse(missing)).toMatchObject({
      ok: false,
      reason: 'invalid_pending_request_id',
    });

    const malformed = buildResponse();
    malformed.pendingRequestId = 'invalid';
    expect(validateAssistantChatResponse(malformed)).toMatchObject({
      ok: false,
      reason: 'invalid_pending_request_id',
    });
  });

  it('rejects stored user messages beyond the request limit', () => {
    const response = buildResponse();
    response.conversation.messages[0].text = 'x'.repeat(1_001);

    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_messages',
    });
  });

  it('rejects evidence links outside the HTTPS Quantified Self hosts', () => {
    const response = buildResponse();
    response.conversation.messages[1].evidence![0].links[0].url =
      'https://attacker.example/redirect';

    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_messages',
    });
  });

  it('rejects unexpected fields that could carry raw tool output', () => {
    const response = buildResponse();
    const message = response.conversation.messages[1] as unknown as Record<string, unknown>;
    message.rawToolOutput = {
      providerKey: 'private-provider',
      latitudeDegrees: 39.665,
    };

    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_messages',
    });
  });

  it('accepts bounded deterministic charts and maps on assistant messages', () => {
    expect(validateAssistantConversation(buildResponse().conversation).ok).toBe(true);
  });

  it('rejects malformed, duplicate, or user-owned visual payloads', () => {
    const duplicateKinds = buildResponse();
    duplicateKinds.conversation.messages[1].visuals = [
      duplicateKinds.conversation.messages[1].visuals![0],
      duplicateKinds.conversation.messages[1].visuals![0],
    ];
    expect(validateAssistantConversation(duplicateKinds.conversation).ok).toBe(false);

    const invalidCoordinate = buildResponse();
    const map = invalidCoordinate.conversation.messages[1].visuals![1];
    if (map.kind === 'map') {
      map.markers[0].latitudeDegrees = 91;
    }
    expect(validateAssistantConversation(invalidCoordinate.conversation).ok).toBe(false);

    const arbitraryMapStyle = buildResponse();
    const styledMap = arbitraryMapStyle.conversation.messages[1].visuals![1];
    if (styledMap.kind === 'map') {
      (styledMap as unknown as Record<string, unknown>).style = 'attacker-authored-style';
    }
    expect(validateAssistantConversation(arbitraryMapStyle.conversation).ok).toBe(false);

    const rawConfig = buildResponse();
    const chart = rawConfig.conversation.messages[1].visuals![0] as unknown as Record<string, unknown>;
    chart.echartsOptions = { tooltip: { formatter: '<img src=x>' } };
    expect(validateAssistantConversation(rawConfig.conversation).ok).toBe(false);

    const invalidTimeZone = buildResponse();
    const timeChart = invalidTimeZone.conversation.messages[1].visuals![0];
    if (timeChart.kind === 'chart') {
      timeChart.xAxis.timeZone = 'Not/A_Time_Zone';
    }
    expect(validateAssistantConversation(invalidTimeZone.conversation).ok).toBe(false);

    const userVisual = buildResponse();
    userVisual.conversation.messages[0].visuals =
      userVisual.conversation.messages[1].visuals;
    expect(validateAssistantConversation(userVisual.conversation).ok).toBe(false);
  });

  it('rejects visual series and payloads beyond their storage budgets', () => {
    const tooManyPoints = buildResponse();
    const chart = tooManyPoints.conversation.messages[1].visuals![0];
    if (chart.kind === 'chart') {
      chart.series[0].points = Array.from({ length: 301 }, (_, index) => ({
        x: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
        y: index,
      }));
    }
    expect(validateAssistantConversation(tooManyPoints.conversation).ok).toBe(false);

    const oversized = buildResponse();
    const oversizedChart = oversized.conversation.messages[1].visuals![0];
    if (oversizedChart.kind === 'chart') {
      oversizedChart.series = Array.from({ length: 4 }, (_, seriesIndex) => ({
        label: `Series ${seriesIndex} ${'x'.repeat(90)}`,
        unit: 'milliseconds',
        points: Array.from({ length: 300 }, (_, pointIndex) => ({
          x: `Category ${pointIndex} ${'y'.repeat(90)}`,
          y: pointIndex,
        })),
      }));
      oversizedChart.xAxis.type = 'category';
      oversizedChart.xAxis.timeZone = null;
    }
    expect(validateAssistantConversation(oversized.conversation).ok).toBe(false);
  });

  it('rejects unexpected top-level response fields', () => {
    const response = buildResponse() as unknown as Record<string, unknown>;
    response.debugPayload = { sourceKey: 'private-source' };

    expect(validateAssistantChatResponse(response)).toMatchObject({
      ok: false,
      reason: 'unexpected_response_fields',
    });
  });

  it('rejects allowlisted hosts on unexpected ports or with credentials', () => {
    for (const url of [
      'https://quantified-self.io:444/user/me/event/activity',
      'https://user:password@quantified-self.io/user/me/event/activity',
    ]) {
      const response = buildResponse();
      response.conversation.messages[1].evidence![0].links[0].url = url;
      expect(validateAssistantConversation(response.conversation).ok).toBe(false);
    }
  });

  it('accepts explicit loopback links returned by the local Functions emulator', () => {
    const response = buildResponse();
    response.conversation.messages[1].evidence![0].links[0].url =
      'https://localhost:4200/user/me/event/activity';

    expect(validateAssistantConversation(response.conversation).ok).toBe(true);
  });

  it('rejects impossible message ordering, duplicate IDs, and user evidence', () => {
    const impossibleOrder = buildResponse();
    impossibleOrder.conversation.messages.reverse();
    expect(validateAssistantConversation(impossibleOrder.conversation).ok).toBe(false);

    const duplicateIds = buildResponse();
    duplicateIds.conversation.messages[1].id = duplicateIds.conversation.messages[0].id;
    expect(validateAssistantConversation(duplicateIds.conversation).ok).toBe(false);

    const userEvidence = buildResponse();
    userEvidence.conversation.messages[0].evidence =
      userEvidence.conversation.messages[1].evidence;
    expect(validateAssistantConversation(userEvidence.conversation).ok).toBe(false);
  });

  it('rejects malformed quota counters', () => {
    const response = buildResponse();
    response.quota.remainingCount = -1;

    expect(validateAssistantChatResponse(response)).toMatchObject({
      ok: false,
      reason: 'invalid_quota',
    });

    const unsafeCount = buildResponse();
    unsafeCount.quota.successfulRequestCount = Number.MAX_SAFE_INTEGER + 1;
    expect(validateAssistantChatResponse(unsafeCount)).toMatchObject({
      ok: false,
      reason: 'invalid_quota',
    });
  });

  it('rejects internally inconsistent quota state', () => {
    const wrongRemaining = buildResponse();
    wrongRemaining.quota.remainingCount = 18;
    expect(validateAssistantChatResponse(wrongRemaining).ok).toBe(false);

    const wrongBlockedReason = buildResponse();
    wrongBlockedReason.quota.blockedReason = 'limit_reached';
    expect(validateAssistantChatResponse(wrongBlockedReason).ok).toBe(false);

    const missingPeriodEnd = buildResponse();
    missingPeriodEnd.quota.periodEnd = null;
    expect(validateAssistantChatResponse(missingPeriodEnd).ok).toBe(false);
  });

  it('rejects date-like strings that are not canonical UTC timestamps', () => {
    const response = buildResponse();
    response.conversation.expiresAt = '2026-08-10';

    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_expiry',
    });

    response.conversation.expiresAt = '2026-02-31T12:00:00.000Z';
    expect(validateAssistantConversation(response.conversation)).toMatchObject({
      ok: false,
      reason: 'invalid_expiry',
    });
  });
});
