import { describe, expect, it, vi } from 'vitest';
import {
  AssistantConversationStoreError,
  type AssistantConversationStore,
} from './conversation-store';
import type { AssistantCallableDependencies } from './callable';
import {
  ASSISTANT_CALLABLE_OPTIONS,
  resolveAssistantAppBaseUrl,
  runAssistantChat,
  runGetAssistantConversation,
  runResetAssistantConversation,
} from './callable';

const quota = {
  role: 'pro' as const,
  limit: 100,
  successfulRequestCount: 1,
  activeRequestCount: 0,
  remainingCount: 99,
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-09-01T00:00:00.000Z',
  periodKind: 'subscription' as const,
  resetMode: 'date' as const,
  isEligible: true,
  blockedReason: null,
};

function createDependencies() {
  const conversation = {
    version: 1 as const,
    conversationId: 'conversation-1',
    messages: [{
      id: 'assistant-message',
      role: 'assistant' as const,
      text: 'Your readiness is 72 today.',
      createdAt: '2026-08-03T12:00:00.000Z',
      evidence: [],
    }],
    expiresAt: '2026-08-10T12:00:00.000Z',
  };
  const store: AssistantConversationStore = {
    getActiveConversation: vi.fn().mockResolvedValue(null),
    beginTurn: vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      history: [],
    }),
    completeTurn: vi.fn().mockResolvedValue(conversation),
    releaseTurn: vi.fn().mockResolvedValue(undefined),
    resetConversation: vi.fn().mockResolvedValue(conversation),
  };
  const reservation = {
    userID: 'user-1',
    reservationID: 'reservation-1',
    periodDocId: 'period-1',
    role: 'pro' as const,
    limit: 100,
    periodStart: quota.periodStart as string,
    periodEnd: quota.periodEnd as string,
    periodKind: quota.periodKind,
    resetMode: quota.resetMode,
    isEligible: true,
  };
  const dependencies: AssistantCallableDependencies = {
    getQuotaStatus: vi.fn().mockResolvedValue(quota),
    reserveQuota: vi.fn().mockResolvedValue(reservation),
    finalizeQuota: vi.fn().mockResolvedValue(quota),
    releaseQuota: vi.fn().mockResolvedValue(quota),
    conversationStore: store,
    answer: vi.fn().mockResolvedValue({
      answer: 'Your readiness is 72 today.',
      evidence: [],
      toolNames: ['get_daily_report'],
    }),
    createId: vi.fn()
      .mockReturnValueOnce('user-message')
      .mockReturnValueOnce('assistant-message'),
    now: () => new Date('2026-08-03T12:00:00.000Z'),
  };
  return { dependencies, store, reservation, conversation };
}

const context = {
  auth: { uid: 'user-1' },
  app: { appId: 'app-1' },
  rawRequest: {
    get: (name: string) => name === 'origin'
      ? 'https://beta.quantified-self.io'
      : undefined,
  },
};

describe('Assistant callable', () => {
  it('keeps an explicit platform concurrency and instance cost bound', () => {
    expect(ASSISTANT_CALLABLE_OPTIONS).toMatchObject({
      concurrency: 10,
      maxInstances: 10,
      timeoutSeconds: 180,
    });
  });

  it('uses only allowlisted app origins for generated MCP links', () => {
    expect(resolveAssistantAppBaseUrl(context)).toBe('https://beta.quantified-self.io');
    expect(resolveAssistantAppBaseUrl({
      rawRequest: { get: () => 'https://attacker.example' },
    })).toBe('https://quantified-self.io');
    expect(resolveAssistantAppBaseUrl({
      rawRequest: { get: () => 'https://beta.quantified-self.io/path' },
    })).toBe('https://quantified-self.io');
  });

  it('authenticates, consumes quota, and saves a grounded turn', async () => {
    const { dependencies, store, reservation, conversation } = createDependencies();

    await expect(runAssistantChat({
      message: '  How am I today?  ',
      timeZone: 'Europe/Helsinki',
      conversationId: 'conversation-1',
    }, context, dependencies)).resolves.toEqual({
      conversation,
      quota,
    });

    expect(dependencies.reserveQuota).toHaveBeenCalledWith('user-1');
    expect(store.beginTurn).toHaveBeenCalledWith('user-1', 'conversation-1');
    expect(dependencies.finalizeQuota).toHaveBeenCalledWith(reservation);
    expect(dependencies.answer).toHaveBeenCalledWith({
      uid: 'user-1',
      appBaseUrl: 'https://beta.quantified-self.io',
      prompt: 'How am I today?',
      timeZone: 'Europe/Helsinki',
      history: [],
    });
    expect(store.completeTurn).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ turnId: 'turn-1' }),
      expect.objectContaining({ role: 'user', text: 'How am I today?' }),
      expect.objectContaining({ role: 'assistant', text: 'Your readiness is 72 today.' }),
    );
  });

  it('releases an unused quota reservation when the conversation is busy', async () => {
    const { dependencies, store, reservation } = createDependencies();
    vi.mocked(store.beginTurn).mockRejectedValue(new AssistantConversationStoreError(
      'turn_in_progress',
      'Another Assistant response is still in progress.',
    ));

    await expect(runAssistantChat({
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({
      code: 'aborted',
      details: { reason: 'turn_in_progress' },
    });
    expect(dependencies.releaseQuota).toHaveBeenCalledWith(reservation);
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
  });

  it('clears a pending turn but does not refund a consumed model attempt', async () => {
    const { dependencies, store } = createDependencies();
    vi.mocked(dependencies.answer).mockRejectedValue(new Error('model unavailable'));

    await expect(runAssistantChat({
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'unavailable' });
    expect(store.releaseTurn).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ turnId: 'turn-1' }),
    );
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
  });

  it('rejects invalid input before reserving quota', async () => {
    const { dependencies } = createDependencies();

    await expect(runAssistantChat({
      message: '   ',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const { dependencies } = createDependencies();

    await expect(runAssistantChat({
      message: 'How am I today?',
      timeZone: 'UTC',
    }, { app: { appId: 'app-1' } }, dependencies))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('maps conversation load and reset failures to a safe callable error', async () => {
    const { store } = createDependencies();
    vi.mocked(store.getActiveConversation).mockRejectedValue(new Error('firestore detail'));
    vi.mocked(store.resetConversation).mockRejectedValue(new Error('firestore detail'));

    await expect(runGetAssistantConversation(context, store))
      .rejects.toMatchObject({ code: 'unavailable' });
    await expect(runResetAssistantConversation(context, store))
      .rejects.toMatchObject({ code: 'unavailable' });
  });
});
