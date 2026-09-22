import { describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  AssistantConversationStoreError,
  createAssistantRequestFingerprint,
  type AssistantConversationStore,
} from './conversation-store';
import type { AssistantCallableDependencies } from './callable';
import {
  APPLY_ASSISTANT_TRAINING_PROPOSAL_OPTIONS,
  ASSISTANT_CALLABLE_OPTIONS,
  RESET_ASSISTANT_CONVERSATION_OPTIONS,
  assertAssistantLegalAccess,
  resolveAssistantAppBaseUrl,
  runAssistantChat,
  runApplyAssistantContentProposal,
  runApplyAssistantTrainingProposal,
  runGetAssistantConversation,
  runGetAssistantQuotaStatus,
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
const REQUEST_ID = 'assistant-request-0001';

function createDependencies() {
  const conversation = {
    version: 1 as const,
    conversationId: 'conversation-1',
    messages: [
      {
        id: 'user-message',
        role: 'user' as const,
        text: 'How am I today?',
        createdAt: '2026-08-03T12:00:00.000Z',
      },
      {
        id: 'assistant-message',
        role: 'assistant' as const,
        text: 'Your readiness is 72 today.',
        createdAt: '2026-08-03T12:00:00.000Z',
        evidence: [],
      },
    ],
    expiresAt: '2026-08-10T12:00:00.000Z',
  };
  const store: AssistantConversationStore = {
    getActiveConversation: vi.fn().mockResolvedValue(null),
    getActiveConversationState: vi.fn().mockResolvedValue({
      conversation: null,
      pendingRequestId: null,
      locationAccess: 'coordinate_free',
    }),
    findRequestState: vi.fn().mockResolvedValue(null),
    beginTurn: vi.fn().mockResolvedValue({
      kind: 'started',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      history: [],
      locationAccess: 'coordinate_free',
    }),
    completeTurn: vi.fn().mockResolvedValue(conversation),
    clearTrainingProposal: vi.fn().mockResolvedValue(undefined),
    clearContentProposal: vi.fn().mockResolvedValue(undefined),
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
    assertLegalAccess: vi.fn().mockResolvedValue(undefined),
    getQuotaStatus: vi.fn().mockResolvedValue(quota),
    reserveQuota: vi.fn().mockResolvedValue(reservation),
    finalizeQuota: vi.fn().mockResolvedValue(quota),
    releaseQuota: vi.fn().mockResolvedValue(quota),
    conversationStore: store,
    answer: vi.fn().mockImplementation(async (
      input: Parameters<AssistantCallableDependencies['answer']>[0],
    ) => {
      await input.onBillableAttempt();
      return {
        answer: 'Your readiness is 72 today.',
        evidence: [],
        toolNames: ['get_daily_report'],
        visuals: [],
      };
    }),
    createId: vi.fn().mockReturnValue('assistant-message'),
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
  it('applies a current content proposal through the existing mutation service and clears it', async () => {
    const { store, conversation } = createDependencies();
    const proposal = {
      proposalRef: 'content-proposal-1',
      kind: 'update_activity_tags' as const,
      expiresAtMs: Date.now() + 60_000,
      summary: 'Replace one current activity tag with one.',
      requiresConfirmation: true as const,
      arguments: { activityRef: 'activity-ref', expectedTags: ['Easy'], tags: ['Quality'] },
    };
    vi.mocked(store.getActiveConversationState).mockResolvedValue({
      conversation,
      pendingRequestId: null,
      locationAccess: 'coordinate_free',
      activityTagChangesEnabled: true,
      pendingContentProposal: proposal,
    });
    const updateActivityTags = vi.fn().mockResolvedValue({ changed: true, tags: ['Quality'] });
    const dataService = { updateActivityTags };

    await expect(runApplyAssistantContentProposal({
      proposalRef: proposal.proposalRef,
      conversationId: conversation.conversationId,
      confirm: true,
    }, context, store, dataService as never)).resolves.toEqual({
      status: 'applied', kind: 'update_activity_tags', message: 'Activity tags updated.',
    });
    expect(updateActivityTags).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: `first-party-assistant-v1:${conversation.conversationId}`,
      assistantConversationId: conversation.conversationId,
      assistantProposalRef: proposal.proposalRef,
      arguments: proposal.arguments,
    }));
    expect(store.clearContentProposal).toHaveBeenCalledWith(
      'user-1', conversation.conversationId, proposal.proposalRef,
    );
  });

  it('reports an accepted idempotent content write even if proposal cleanup loses a race', async () => {
    const { store, conversation } = createDependencies();
    const proposal = {
      proposalRef: 'content-proposal-1',
      kind: 'update_activity_tags' as const,
      expiresAtMs: Date.now() + 60_000,
      summary: 'Replace one current activity tag with one.',
      requiresConfirmation: true as const,
      arguments: { activityRef: 'activity-ref', expectedTags: ['Easy'], tags: ['Quality'] },
    };
    vi.mocked(store.getActiveConversationState).mockResolvedValue({
      conversation, pendingRequestId: null, locationAccess: 'coordinate_free',
      activityTagChangesEnabled: true, pendingContentProposal: proposal,
    });
    vi.mocked(store.clearContentProposal).mockRejectedValue(
      new AssistantConversationStoreError('conversation_changed', 'A newer proposal is current.'),
    );
    const updateActivityTags = vi.fn().mockResolvedValue({ changed: true, tags: ['Quality'] });

    await expect(runApplyAssistantContentProposal({
      proposalRef: proposal.proposalRef,
      conversationId: conversation.conversationId,
      confirm: true,
    }, context, store, { updateActivityTags } as never)).resolves.toMatchObject({
      status: 'applied',
      kind: 'update_activity_tags',
    });
    expect(updateActivityTags).toHaveBeenCalledOnce();
  });

  it('dismisses a content proposal without calling a mutation service', async () => {
    const { store, conversation } = createDependencies();
    const proposal = {
      proposalRef: 'content-proposal-1',
      kind: 'delete_timeline_note' as const,
      expiresAtMs: Date.now() + 60_000,
      summary: 'Permanently delete the selected Timeline note.',
      requiresConfirmation: true as const,
      arguments: { noteRef: 'note-ref', expectedRevision: 2 },
    };
    vi.mocked(store.getActiveConversationState).mockResolvedValue({
      conversation, pendingRequestId: null, locationAccess: 'coordinate_free', timelineNotesEnabled: true,
      timelineNoteChangesEnabled: true, pendingContentProposal: proposal,
    });
    const deleteTimelineNote = vi.fn();
    await expect(runApplyAssistantContentProposal({ proposalRef: proposal.proposalRef,
      conversationId: conversation.conversationId, confirm: false }, context, store,
    { deleteTimelineNote } as never)).resolves.toMatchObject({ status: 'dismissed' });
    expect(deleteTimelineNote).not.toHaveBeenCalled();
  });

  it('dismisses only the current server-owned Training proposal without applying it', async () => {
    const { store } = createDependencies();
    const proposal = { proposalRef: 'opaque-proposal', permissionMode: 'combined' as const,
      expiresAtMs: Date.parse('2026-08-03T12:15:00Z'), scheduleRevision: 7,
      summary: 'Create and send a workout.', requiresConfirmation: true as const,
      changes: [{ index: 0, kind: 'create-workout', summary: 'Create it.' }], providerPreviews: [] };
    vi.mocked(store.getActiveConversationState).mockResolvedValue({
      conversation: { version: 1, conversationId: 'conversation-1', messages: [],
        expiresAt: '2026-08-10T12:00:00.000Z' }, pendingRequestId: null, locationAccess: 'coordinate_free',
      trainingPlansEnabled: true, trainingPlanChangesEnabled: true, trainingDeliveryEnabled: true,
      pendingTrainingProposal: proposal,
    });
    await expect(runApplyAssistantTrainingProposal({ proposalRef: proposal.proposalRef,
      permissionMode: proposal.permissionMode, conversationId: 'conversation-1', confirm: false }, context, store))
      .resolves.toEqual({ status: 'dismissed', scheduleRevision: 7, changes: [], providers: [] });
    expect(store.clearTrainingProposal).toHaveBeenCalledWith('user-1', 'conversation-1', proposal.proposalRef);
  });

  it('applies the current proposal with the exact Assistant conversation authority and then clears it', async () => {
    const { store } = createDependencies();
    const proposal = { proposalRef: 'opaque-proposal', permissionMode: 'combined' as const,
      expiresAtMs: Date.parse('2026-08-03T12:15:00Z'), scheduleRevision: 7,
      summary: 'Create and send a workout.', requiresConfirmation: true as const,
      changes: [{ index: 0, kind: 'create-workout', summary: 'Create it.' }], providerPreviews: [] };
    vi.mocked(store.getActiveConversationState).mockResolvedValue({
      conversation: { version: 1, conversationId: 'conversation-1', messages: [],
        expiresAt: '2026-08-10T12:00:00.000Z' }, pendingRequestId: null, locationAccess: 'coordinate_free',
      trainingPlansEnabled: true, trainingPlanChangesEnabled: true, trainingDeliveryEnabled: true,
      pendingTrainingProposal: proposal,
    });
    const applyProposal = vi.fn().mockResolvedValue({ proposalRef: proposal.proposalRef, status: 'applied' as const,
      scheduleRevision: 8, changes: [{ index: 0, kind: 'create-workout', status: 'applied' as const,
        message: 'Created the workout.' }], providers: [{ index: 1, provider: 'garmin' as const,
        status: 'applied' as const, message: 'Delivery was queued.' }], createdReferences: [] });

    await expect(runApplyAssistantTrainingProposal({ proposalRef: proposal.proposalRef,
      permissionMode: proposal.permissionMode, conversationId: 'conversation-1', confirm: true }, context, store, applyProposal))
      .resolves.toMatchObject({ status: 'applied', scheduleRevision: 8 });
    expect(applyProposal).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'user-1', connectionId: 'first-party-assistant-v1:conversation-1',
      scopes: ['training-plans:read', 'training-plans:write', 'training-delivery:write'],
      arguments: { proposalRef: proposal.proposalRef, permissionMode: 'combined' },
    }));
    expect(store.clearTrainingProposal).toHaveBeenCalledWith('user-1', 'conversation-1', proposal.proposalRef);
  });

  it('does not expose unexpected apply failures through the Assistant callable', async () => {
    const { store } = createDependencies();
    const proposal = { proposalRef: 'opaque-proposal', permissionMode: 'schedule' as const,
      expiresAtMs: Date.now() + 60_000, scheduleRevision: 7,
      summary: 'Create a workout.', requiresConfirmation: true as const,
      changes: [{ index: 0, kind: 'create-workout', summary: 'Create it.' }], providerPreviews: [] };
    vi.mocked(store.getActiveConversationState).mockResolvedValue({
      conversation: { version: 1, conversationId: 'conversation-1', messages: [],
        expiresAt: '2026-08-10T12:00:00.000Z' }, pendingRequestId: null, locationAccess: 'coordinate_free',
      trainingPlansEnabled: true, trainingPlanChangesEnabled: true, trainingDeliveryEnabled: false,
      pendingTrainingProposal: proposal,
    });
    const applyProposal = vi.fn().mockRejectedValue(new Error('private-provider-account-token'));

    const response = runApplyAssistantTrainingProposal({ proposalRef: proposal.proposalRef,
      permissionMode: proposal.permissionMode, conversationId: 'conversation-1', confirm: true }, context, store, applyProposal);
    await expect(response).rejects.toMatchObject({ code: 'internal',
      message: 'The Training proposal could not be applied safely.' });
    await expect(response).rejects.not.toThrow('private-provider-account-token');
  });

  it('returns Assistant quota status using Firestore role resolution in hosted mode', async () => {
    const getQuotaStatus = vi.fn().mockResolvedValue(quota);

    await expect(runGetAssistantQuotaStatus({
      auth: {
        uid: 'user-1',
        token: { stripeRole: 'basic' },
      },
      app: { appId: 'app-1' },
    }, getQuotaStatus)).resolves.toEqual(quota);

    expect(getQuotaStatus).toHaveBeenCalledWith('user-1');
  });

  it('uses callable role claims only in explicit Functions emulator mode', async () => {
    const originalFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
    process.env.FUNCTIONS_EMULATOR = 'true';
    const getQuotaStatus = vi.fn().mockResolvedValue(quota);

    try {
      await expect(runGetAssistantQuotaStatus({
        auth: {
          uid: 'user-1',
          token: {
            stripeRole: 'basic',
            gracePeriodUntil: '1775237359811',
          },
        },
        app: { appId: 'app-1' },
      }, getQuotaStatus)).resolves.toEqual(quota);

      expect(getQuotaStatus).toHaveBeenCalledWith('user-1', {
        role: 'basic',
        gracePeriodUntil: 1775237359811,
      });
    } finally {
      if (originalFunctionsEmulator === undefined) {
        delete process.env.FUNCTIONS_EMULATOR;
      } else {
        process.env.FUNCTIONS_EMULATOR = originalFunctionsEmulator;
      }
    }
  });

  it('checks the server-authoritative required legal agreements', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          acceptedPrivacyPolicy: true,
          acceptedDataPolicy: true,
          acceptedTos: true,
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          acceptedPrivacyPolicy: true,
          acceptedDataPolicy: false,
          acceptedTos: true,
        }),
      });
    const db = {
      doc: vi.fn(() => ({ get })),
    };

    await expect(assertAssistantLegalAccess('user-1', db as never))
      .resolves.toBeUndefined();
    await expect(assertAssistantLegalAccess('user-1', db as never))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.doc).toHaveBeenCalledWith('users/user-1/legal/agreements');
  });

  it('keeps an explicit platform concurrency and instance cost bound', () => {
    expect(ASSISTANT_CALLABLE_OPTIONS).toMatchObject({
      concurrency: 10,
      maxInstances: 10,
      timeoutSeconds: 180,
    });
  });

  it('gives conversation changes enough memory for the shared Assistant runtime', () => {
    expect(RESET_ASSISTANT_CONVERSATION_OPTIONS.memory).toBe('512MiB');
    expect(APPLY_ASSISTANT_TRAINING_PROPOSAL_OPTIONS.memory).toBe('512MiB');
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
      requestId: REQUEST_ID,
      message: '  How am I today?  ',
      timeZone: 'Europe/Helsinki',
      conversationId: 'conversation-1',
    }, context, dependencies)).resolves.toEqual({
      conversation,
      quota,
      pendingRequestId: null,
    });

    expect(dependencies.assertLegalAccess).toHaveBeenCalledWith('user-1');
    expect(dependencies.reserveQuota).toHaveBeenCalledWith('user-1');
    expect(store.beginTurn).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      REQUEST_ID,
      createAssistantRequestFingerprint(REQUEST_ID, 'How am I today?'),
      'coordinate_free',
      false, false, false, false, false, false);
    expect(dependencies.finalizeQuota).toHaveBeenCalledWith(reservation);
    expect(dependencies.answer).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'user-1',
      appBaseUrl: 'https://beta.quantified-self.io',
      prompt: 'How am I today?',
      timeZone: 'Europe/Helsinki',
      locationAccess: 'coordinate_free',
      history: [],
      onBillableAttempt: expect.any(Function),
    }));
    expect(store.completeTurn).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ turnId: 'turn-1' }),
      expect.objectContaining({
        id: REQUEST_ID,
        role: 'user',
        text: 'How am I today?',
      }),
      expect.objectContaining({ role: 'assistant', text: 'Your readiness is 72 today.' }),
      undefined,
      undefined,
    );
  });

  it('binds explicit precise activity-location access through idempotency and runtime', async () => {
    const { dependencies, store } = createDependencies();
    vi.mocked(store.beginTurn).mockResolvedValue({
      kind: 'started',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      history: [],
      locationAccess: 'precise_activity',
    });

    await runAssistantChat({
      requestId: REQUEST_ID,
      message: 'Where was my biggest jump?',
      timeZone: 'Europe/Helsinki',
      locationAccess: 'precise_activity',
      conversationId: 'conversation-1',
    }, context, dependencies);

    expect(store.beginTurn).toHaveBeenCalledWith(
      'user-1',
      'conversation-1',
      REQUEST_ID,
      createAssistantRequestFingerprint(
        REQUEST_ID,
        'Where was my biggest jump?',
        'precise_activity',
      ),
      'precise_activity',
      false, false, false, false, false, false);
    expect(dependencies.answer).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Where was my biggest jump?',
      locationAccess: 'precise_activity',
    }));
  });

  it('binds notes access to the server-owned chat and rechecks the generation around private reads', async () => {
    const { dependencies, store, conversation } = createDependencies();
    vi.mocked(store.beginTurn).mockResolvedValue({ kind: 'started', conversationId: 'conversation-1', turnId: 'turn-1',
      history: [], locationAccess: 'coordinate_free', timelineNotesEnabled: true });
    vi.mocked(store.getActiveConversationState).mockResolvedValue({ conversation, pendingRequestId: REQUEST_ID,
      locationAccess: 'coordinate_free', timelineNotesEnabled: true });
    vi.mocked(dependencies.answer).mockImplementation(async input => {
      expect(input.timelineNotesEnabled).toBe(true);
      await input.assertTimelineNotesAccess!();
      await input.onBillableAttempt();
      return { answer: 'User-reported context.', evidence: [], toolNames: ['query_timeline_notes'], visuals: [] };
    });
    const request = { requestId: REQUEST_ID, message: 'What did my note say?', timeZone: 'UTC',
      locationAccess: 'coordinate_free', timelineNotesEnabled: true, conversationId: 'conversation-1' };
    expect(await runAssistantChat(request, context, dependencies)).toMatchObject({ timelineNotesEnabled: true });
    expect(store.beginTurn).toHaveBeenCalledWith('user-1', 'conversation-1', REQUEST_ID,
      createAssistantRequestFingerprint(REQUEST_ID, request.message, 'coordinate_free', true), 'coordinate_free', true,
      false, false, false, false, false);
    vi.mocked(store.getActiveConversationState).mockResolvedValue({ conversation: { ...conversation, conversationId: 'new-chat' },
      pendingRequestId: null, locationAccess: 'coordinate_free', timelineNotesEnabled: false });
    await expect(runAssistantChat(request, context, dependencies)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects a replay under a different notes permission and malformed consent before work', async () => {
    const { dependencies, store, conversation } = createDependencies();
    const request = { requestId: REQUEST_ID, message: 'Notes?', timeZone: 'UTC' };
    vi.mocked(store.findRequestState).mockResolvedValue({ kind: 'replayed', conversation,
      requestFingerprint: createAssistantRequestFingerprint(REQUEST_ID, request.message, 'coordinate_free', true) });
    await expect(runAssistantChat(request, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(runAssistantChat({ ...request, timelineNotesEnabled: 'yes' }, context, dependencies))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(dependencies.answer).not.toHaveBeenCalled();
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    await expect(runResetAssistantConversation({ locationAccess: 'precise_activity', timelineNotesEnabled: true, conversationId: null }, context, store))
      .resolves.toMatchObject({ timelineNotesEnabled: true });
    expect(store.resetConversation).toHaveBeenLastCalledWith('user-1', 'precise_activity', true, null,
      false, false, false, false, false);
  });

  it.each([undefined, '', ' ', 42, 'x'.repeat(121)])('rejects an unbound or malformed notes reset generation: %j', async conversationId => {
    const { store } = createDependencies();
    await expect(runResetAssistantConversation({ timelineNotesEnabled: true, conversationId }, context, store))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(store.resetConversation).not.toHaveBeenCalled();
  });

  it('passes the expected notes generation to the transaction and reports stale consent safely', async () => {
    const { store } = createDependencies();
    vi.mocked(store.resetConversation).mockRejectedValue(new AssistantConversationStoreError('conversation_changed', 'Changed'));
    await expect(runResetAssistantConversation({ timelineNotesEnabled: true, conversationId: 'old-chat' }, context, store))
      .rejects.toMatchObject({ code: 'aborted' });
    expect(store.resetConversation).toHaveBeenCalledWith('user-1', 'coordinate_free', true, 'old-chat',
      false, false, false, false, false);
  });

  it('persists bounded server-owned visuals with the assistant message', async () => {
    const { dependencies, store } = createDependencies();
    vi.mocked(dependencies.answer).mockImplementation(async input => {
      await input.onBillableAttempt();
      return {
        answer: 'Your HRV trend is shown below.',
        evidence: [],
        toolNames: ['get_sleep_trend'],
        visuals: [{
          kind: 'chart',
          title: 'Overnight HRV trend',
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
            points: [{ x: '2026-08-03T00:00:00.000Z', y: 52 }],
          }],
        }],
      };
    });

    await runAssistantChat({
      requestId: REQUEST_ID,
      message: 'Show my HRV trend.',
      timeZone: 'Europe/Helsinki',
    }, context, dependencies);

    expect(store.completeTurn).toHaveBeenCalledWith(
      'user-1',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        visuals: [expect.objectContaining({ kind: 'chart' })],
      }),
      undefined,
      undefined,
    );
  });

  it('rejects unknown Assistant location-access modes before reserving quota', async () => {
    const { dependencies } = createDependencies();

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'Where was my biggest jump?',
      timeZone: 'Europe/Helsinki',
      locationAccess: 'all_locations',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
  });

  it('requires accepted legal agreements before reserving quota or starting a turn', async () => {
    const { dependencies, store } = createDependencies();
    vi.mocked(dependencies.assertLegalAccess).mockRejectedValue(new HttpsError(
      'permission-denied',
      'Complete onboarding before using the Assistant.',
    ));

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(store.beginTurn).not.toHaveBeenCalled();
  });

  it('releases an unused quota reservation when the conversation is busy', async () => {
    const { dependencies, store, reservation } = createDependencies();
    vi.mocked(store.beginTurn).mockRejectedValue(new AssistantConversationStoreError(
      'turn_in_progress',
      'Another Assistant response is still in progress.',
    ));

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({
      code: 'aborted',
      details: { reason: 'turn_in_progress' },
    });
    expect(dependencies.reserveQuota).toHaveBeenCalledWith('user-1');
    expect(dependencies.releaseQuota).toHaveBeenCalledWith(reservation);
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
  });

  it('acknowledges an identical in-flight retry without returning an HTTP conflict', async () => {
    const { dependencies, store, reservation, conversation } = createDependencies();
    vi.mocked(store.beginTurn).mockResolvedValue({
      kind: 'pending',
      conversation,
      requestFingerprint: createAssistantRequestFingerprint(
        REQUEST_ID,
        'How am I today?',
      ),
    });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).resolves.toEqual({
      conversation,
      quota,
      pendingRequestId: REQUEST_ID,
    });

    expect(dependencies.releaseQuota).toHaveBeenCalledWith(reservation);
    expect(dependencies.answer).not.toHaveBeenCalled();
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
    expect(store.releaseTurn).not.toHaveBeenCalled();
  });

  it('acknowledges an existing in-flight request before reserving its last quota slot', async () => {
    const { dependencies, store, conversation } = createDependencies();
    const exhaustedQuota = {
      ...quota,
      successfulRequestCount: quota.limit - 1,
      activeRequestCount: 1,
      remainingCount: 0,
      blockedReason: 'limit_reached' as const,
    };
    vi.mocked(store.findRequestState).mockResolvedValue({
      kind: 'pending',
      conversation,
      requestFingerprint: createAssistantRequestFingerprint(
        REQUEST_ID,
        'How am I today?',
      ),
    });
    vi.mocked(dependencies.getQuotaStatus).mockResolvedValue(exhaustedQuota);

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).resolves.toEqual({
      conversation,
      quota: exhaustedQuota,
      pendingRequestId: REQUEST_ID,
    });

    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(store.beginTurn).not.toHaveBeenCalled();
    expect(dependencies.answer).not.toHaveBeenCalled();
  });

  it('does not acquire a turn lock when quota cannot be reserved', async () => {
    const { dependencies, store } = createDependencies();
    vi.mocked(dependencies.reserveQuota).mockRejectedValue(new HttpsError(
      'resource-exhausted',
      'Assistant limit reached for this billing period.',
    ));

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(store.beginTurn).not.toHaveBeenCalled();
    expect(store.releaseTurn).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
  });

  it('clears a pending turn but does not refund a consumed model attempt', async () => {
    const { dependencies, store } = createDependencies();
    vi.mocked(dependencies.answer).mockImplementation(async input => {
      await input.onBillableAttempt();
      throw new Error('model unavailable');
    });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'unavailable' });
    expect(store.releaseTurn).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ turnId: 'turn-1' }),
    );
    expect(dependencies.answer).toHaveBeenCalledTimes(2);
    expect(dependencies.finalizeQuota).toHaveBeenCalledTimes(1);
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
  });

  it('recovers one runtime setup failure without consuming another allowance', async () => {
    const { dependencies, store, conversation } = createDependencies();
    vi.mocked(dependencies.answer).mockRejectedValueOnce(
      new Error('MCP session setup unavailable'),
    );

    const request = {
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
      conversationId: 'conversation-1',
    };
    await expect(runAssistantChat(request, context, dependencies)).resolves.toEqual({
      conversation,
      quota,
      pendingRequestId: null,
    });
    expect(dependencies.reserveQuota).toHaveBeenCalledOnce();
    expect(dependencies.answer).toHaveBeenCalledTimes(2);
    expect(dependencies.finalizeQuota).toHaveBeenCalledTimes(1);
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(store.releaseTurn).not.toHaveBeenCalled();
  });

  it('releases a quota reservation when both runtime setup attempts fail', async () => {
    const { dependencies, store, reservation } = createDependencies();
    vi.mocked(dependencies.answer).mockRejectedValue(
      new Error('MCP session setup unavailable'),
    );

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
      conversationId: 'conversation-1',
    }, context, dependencies)).rejects.toMatchObject({ code: 'unavailable' });

    expect(dependencies.answer).toHaveBeenCalledTimes(2);
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).toHaveBeenCalledWith(reservation);
    expect(store.releaseTurn).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ turnId: 'turn-1' }),
    );
  });

  it('retries a failed billable generation under the same finalized allowance', async () => {
    const { dependencies, store, conversation } = createDependencies();
    vi.mocked(dependencies.answer)
      .mockImplementationOnce(async input => {
        await input.onBillableAttempt();
        throw new Error('invalid model response');
      });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).resolves.toEqual({
      conversation,
      quota,
      pendingRequestId: null,
    });

    expect(dependencies.answer).toHaveBeenCalledTimes(2);
    expect(dependencies.finalizeQuota).toHaveBeenCalledTimes(1);
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(store.releaseTurn).not.toHaveBeenCalled();
    expect(store.completeTurn).toHaveBeenCalledOnce();
  });

  it('does not retry when quota finalization itself fails', async () => {
    const { dependencies, store, reservation } = createDependencies();
    vi.mocked(dependencies.finalizeQuota).mockRejectedValue(
      new Error('quota persistence unavailable'),
    );
    vi.mocked(dependencies.answer).mockImplementation(async input => {
      await input.onBillableAttempt();
      throw new Error('should not reach generation');
    });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'unavailable' });

    expect(dependencies.answer).toHaveBeenCalledOnce();
    expect(dependencies.finalizeQuota).toHaveBeenCalledOnce();
    expect(dependencies.releaseQuota).toHaveBeenCalledWith(reservation);
    expect(store.releaseTurn).toHaveBeenCalledOnce();
  });

  it('does not retry a permanent callable error from grounded work', async () => {
    const { dependencies, store, reservation } = createDependencies();
    vi.mocked(dependencies.answer).mockRejectedValue(new HttpsError(
      'permission-denied',
      'Grounded access denied.',
    ));

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'permission-denied' });

    expect(dependencies.answer).toHaveBeenCalledOnce();
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).toHaveBeenCalledWith(reservation);
    expect(store.releaseTurn).toHaveBeenCalledOnce();
  });

  it('does not retry a permanent Genkit provider error', async () => {
    const { dependencies, store } = createDependencies();
    const providerError = Object.assign(new Error('Invalid model request.'), {
      name: 'GenkitError',
      status: 'INVALID_ARGUMENT',
    });
    vi.mocked(dependencies.answer).mockImplementation(async input => {
      await input.onBillableAttempt();
      throw providerError;
    });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'unavailable' });

    expect(dependencies.answer).toHaveBeenCalledOnce();
    expect(dependencies.finalizeQuota).toHaveBeenCalledOnce();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(store.releaseTurn).toHaveBeenCalledOnce();
  });

  it('rejects invalid input before reserving quota', async () => {
    const { dependencies } = createDependencies();

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: '   ',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
      conversationId: '   ',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(dependencies.assertLegalAccess).not.toHaveBeenCalled();
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed request identifier before backend work', async () => {
    const { dependencies, store } = createDependencies();

    await expect(runAssistantChat({
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(runAssistantChat({
      requestId: 'too short',
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(dependencies.assertLegalAccess).not.toHaveBeenCalled();
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(store.beginTurn).not.toHaveBeenCalled();
  });

  it('replays a completed request after it consumed the final quota slot', async () => {
    const { dependencies, store, conversation } = createDependencies();
    const completedConversation = {
      ...conversation,
      messages: [
        { ...conversation.messages[0], id: REQUEST_ID },
        conversation.messages[1],
      ],
    };
    const exhaustedQuota = {
      ...quota,
      successfulRequestCount: quota.limit,
      remainingCount: 0,
      blockedReason: 'limit_reached' as const,
    };
    vi.mocked(dependencies.getQuotaStatus).mockResolvedValue(exhaustedQuota);
    vi.mocked(store.findRequestState).mockResolvedValue({
      kind: 'replayed',
      conversation: completedConversation,
      requestFingerprint: createAssistantRequestFingerprint(
        REQUEST_ID,
        'How am I today?',
      ),
    });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
      conversationId: 'conversation-1',
    }, context, dependencies)).resolves.toEqual({
      conversation: completedConversation,
      quota: exhaustedQuota,
      pendingRequestId: null,
    });

    expect(dependencies.getQuotaStatus).toHaveBeenCalledWith('user-1');
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
    expect(dependencies.answer).not.toHaveBeenCalled();
    expect(store.beginTurn).not.toHaveBeenCalled();
    expect(store.completeTurn).not.toHaveBeenCalled();
  });

  it('rechecks replay when the final quota slot completes during reservation', async () => {
    const { dependencies, store, conversation } = createDependencies();
    const completedConversation = {
      ...conversation,
      messages: [
        { ...conversation.messages[0], id: REQUEST_ID },
        conversation.messages[1],
      ],
    };
    const exhaustedQuota = {
      ...quota,
      successfulRequestCount: quota.limit,
      remainingCount: 0,
      blockedReason: 'limit_reached' as const,
    };
    vi.mocked(store.findRequestState)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        kind: 'replayed',
        conversation: completedConversation,
        requestFingerprint: createAssistantRequestFingerprint(
          REQUEST_ID,
          'How am I today?',
        ),
      });
    vi.mocked(dependencies.reserveQuota).mockRejectedValue(new HttpsError(
      'resource-exhausted',
      'Assistant limit reached for this billing period.',
    ));
    vi.mocked(dependencies.getQuotaStatus).mockResolvedValue(exhaustedQuota);

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).resolves.toEqual({
      conversation: completedConversation,
      quota: exhaustedQuota,
      pendingRequestId: null,
    });

    expect(store.findRequestState).toHaveBeenCalledTimes(2);
    expect(store.beginTurn).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(dependencies.answer).not.toHaveBeenCalled();
  });

  it('rechecks a pending retry when its final quota slot is reserved concurrently', async () => {
    const { dependencies, store, conversation } = createDependencies();
    const exhaustedQuota = {
      ...quota,
      successfulRequestCount: quota.limit - 1,
      activeRequestCount: 1,
      remainingCount: 0,
      blockedReason: 'limit_reached' as const,
    };
    vi.mocked(store.findRequestState)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        kind: 'pending',
        conversation,
        requestFingerprint: createAssistantRequestFingerprint(
          REQUEST_ID,
          'How am I today?',
        ),
      });
    vi.mocked(dependencies.reserveQuota).mockRejectedValue(new HttpsError(
      'resource-exhausted',
      'Assistant limit reached for this billing period.',
    ));
    vi.mocked(dependencies.getQuotaStatus).mockResolvedValue(exhaustedQuota);

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).resolves.toEqual({
      conversation,
      quota: exhaustedQuota,
      pendingRequestId: REQUEST_ID,
    });

    expect(store.findRequestState).toHaveBeenCalledTimes(2);
    expect(store.beginTurn).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(dependencies.answer).not.toHaveBeenCalled();
  });

  it('releases a reservation when the request completes before turn acquisition', async () => {
    const { dependencies, store, reservation, conversation } = createDependencies();
    vi.mocked(store.beginTurn).mockResolvedValue({
      kind: 'replayed',
      conversation,
      requestFingerprint: createAssistantRequestFingerprint(
        REQUEST_ID,
        'How am I today?',
      ),
    });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).resolves.toEqual({
      conversation,
      quota,
      pendingRequestId: null,
    });

    expect(dependencies.reserveQuota).toHaveBeenCalledWith('user-1');
    expect(dependencies.releaseQuota).toHaveBeenCalledWith(reservation);
    expect(dependencies.getQuotaStatus).not.toHaveBeenCalled();
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
    expect(dependencies.answer).not.toHaveBeenCalled();
  });

  it('maps a completed-request quota refresh failure to a safe error', async () => {
    const { dependencies, store, conversation } = createDependencies();
    vi.mocked(store.findRequestState).mockResolvedValue({
      kind: 'replayed',
      conversation,
      requestFingerprint: createAssistantRequestFingerprint(
        REQUEST_ID,
        'How am I today?',
      ),
    });
    vi.mocked(dependencies.getQuotaStatus).mockRejectedValue(
      new Error('firestore quota detail'),
    );

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'The Assistant could not answer right now. Please try again.',
    });

    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(store.beginTurn).not.toHaveBeenCalled();
  });

  it('rejects reuse of a completed request identifier for different text', async () => {
    const { dependencies, store, conversation } = createDependencies();
    vi.mocked(store.findRequestState).mockResolvedValue({
      kind: 'replayed',
      conversation,
      requestFingerprint: createAssistantRequestFingerprint(
        REQUEST_ID,
        'Original question',
      ),
    });

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'Different question',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(dependencies.getQuotaStatus).not.toHaveBeenCalled();
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
    expect(dependencies.answer).not.toHaveBeenCalled();
    expect(store.beginTurn).not.toHaveBeenCalled();
  });

  it('rejects a request identifier collision before model work', async () => {
    const { dependencies, store } = createDependencies();
    vi.mocked(store.findRequestState).mockRejectedValue(
      new AssistantConversationStoreError(
        'request_id_conflict',
        'The Assistant request identifier conflicts with a saved message.',
      ),
    );

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, context, dependencies)).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(dependencies.finalizeQuota).not.toHaveBeenCalled();
    expect(dependencies.answer).not.toHaveBeenCalled();
    expect(store.beginTurn).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const { dependencies } = createDependencies();

    await expect(runAssistantChat({
      requestId: REQUEST_ID,
      message: 'How am I today?',
      timeZone: 'UTC',
    }, { app: { appId: 'app-1' } }, dependencies))
      .rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('maps conversation load and reset failures to a safe callable error', async () => {
    const { store } = createDependencies();
    vi.mocked(store.getActiveConversationState).mockRejectedValue(new Error('firestore detail'));
    vi.mocked(store.resetConversation).mockRejectedValue(new Error('firestore detail'));

    await expect(runGetAssistantConversation(context, store))
      .rejects.toMatchObject({ code: 'unavailable' });
    await expect(runResetAssistantConversation({}, context, store))
      .rejects.toMatchObject({ code: 'unavailable' });
  });

  it('returns the owner-visible pending request identity with the conversation', async () => {
    const { store, conversation } = createDependencies();
    vi.mocked(store.getActiveConversationState).mockResolvedValue({
      conversation,
      pendingRequestId: REQUEST_ID,
      locationAccess: 'precise_activity',
    });

    await expect(runGetAssistantConversation(context, store)).resolves.toEqual({
      conversation,
      pendingRequestId: REQUEST_ID,
      locationAccess: 'precise_activity',
    });
  });

  it('starts a new server-owned conversation with the requested location boundary', async () => {
    const { store, conversation } = createDependencies();

    await expect(runResetAssistantConversation({
      locationAccess: 'precise_activity',
    }, context, store)).resolves.toEqual({ conversation });

    expect(store.resetConversation).toHaveBeenCalledWith(
      'user-1',
      'precise_activity',
      false,
      undefined, false, false, false, false, false);
  });

  it('rejects an unknown reset location boundary without replacing the conversation', async () => {
    const { store } = createDependencies();

    await expect(runResetAssistantConversation({
      locationAccess: 'all_locations',
    }, context, store)).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(store.resetConversation).not.toHaveBeenCalled();
  });
});
