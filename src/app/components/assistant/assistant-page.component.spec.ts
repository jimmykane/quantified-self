import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantChatResponse } from '@shared/assistant.types';
import {
  ASSISTANT_COMPOSER_EXAMPLE_PROMPT,
  ASSISTANT_STARTER_PROMPTS,
} from '@shared/assistant.prompts';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import {
  AssistantError,
  AssistantService,
} from '../../services/assistant.service';
import { AssistantPageComponent } from './assistant-page.component';

const chatResponse: AssistantChatResponse = {
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
          summary: 'Grounded in Get daily report.',
          facts: [{ label: 'Readiness score', value: '72' }],
          links: [],
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
};

describe('AssistantPageComponent', () => {
  let fixture: ComponentFixture<AssistantPageComponent>;
  let component: AssistantPageComponent;
  const assistantService = {
    getConversation: vi.fn(),
    sendMessage: vi.fn(),
    resetConversation: vi.fn(),
    getErrorMessage: vi.fn(() => 'Friendly error'),
  };
  const quotaService = {
    loadQuotaStatus: vi.fn(),
  };

  beforeEach(async () => {
    assistantService.getConversation.mockReset().mockResolvedValue(null);
    assistantService.sendMessage.mockReset().mockResolvedValue(chatResponse);
    assistantService.resetConversation.mockReset().mockResolvedValue({
      ...chatResponse.conversation,
      messages: [],
    });
    assistantService.getErrorMessage.mockClear();
    quotaService.loadQuotaStatus.mockReset().mockResolvedValue(chatResponse.quota);

    await TestBed.configureTestingModule({
      imports: [
        AssistantPageComponent,
        RouterTestingModule.withRoutes([]),
        NoopAnimationsModule,
        MatIconTestingModule,
      ],
      providers: [
        { provide: AssistantService, useValue: assistantService },
        { provide: AssistantQuotaService, useValue: quotaService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssistantPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the zero-setup welcome state, privacy boundaries, and MCP alternative', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('What would you like to understand?');
    expect(text).toContain('Grounded in the same read-only MCP tools');
    expect(text).toContain('Location and routes are not available');
    expect(text).toContain('Prefer ChatGPT or another compatible client?');
    expect(fixture.nativeElement.querySelector('mat-chip')?.textContent.trim()).toBe('Beta');
    expect(fixture.nativeElement.querySelector('.assistant-welcome')?.classList)
      .toContain('qs-glass-card-panel');
    const renderedPromptButtons = Array.from(
      fixture.nativeElement.querySelectorAll('.starter-prompts button'),
    ) as HTMLElement[];
    expect(renderedPromptButtons).toHaveLength(ASSISTANT_STARTER_PROMPTS.length);
    ASSISTANT_STARTER_PROMPTS.forEach((prompt, index) => {
      expect(renderedPromptButtons[index].textContent).toContain(prompt);
    });
    expect(fixture.nativeElement.querySelector('textarea')?.placeholder)
      .toBe(`For example: ${ASSISTANT_COMPOSER_EXAMPLE_PROMPT}`);
  });

  it('sends a starter prompt and renders the grounded response evidence', async () => {
    component.useStarterPrompt("Give me today's sleep, readiness, and Training report.");
    await component.sendMessage();
    fixture.detectChanges();

    expect(assistantService.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "Give me today's sleep, readiness, and Training report.",
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{16,120}$/),
    }));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Your readiness is 72 today.');
    expect(text).toContain('1 grounded result');
    expect(text).toContain('Get daily report');
    expect(text).toContain('19 of 20 Assistant requests remaining');
  });

  it('starts a new server-owned conversation', async () => {
    component.conversation.set(chatResponse.conversation);

    await component.resetConversation();

    expect(assistantService.resetConversation).toHaveBeenCalledOnce();
    expect(component.messages()).toEqual([]);
  });

  it('does not send after the current Assistant allowance is exhausted', async () => {
    component.quota.set({
      ...chatResponse.quota,
      remainingCount: 0,
      blockedReason: 'limit_reached',
    });
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(component.promptControl.value).toBe('How am I today?');
  });

  it('keeps whitespace-only prompts invalid', async () => {
    await component.ngOnInit();
    component.promptControl.setValue('   \n  ');

    await component.sendMessage();

    expect(component.promptControl.invalid).toBe(true);
    expect(assistantService.sendMessage).not.toHaveBeenCalled();
  });

  it('refreshes the authoritative quota after a failed grounded attempt', async () => {
    assistantService.sendMessage.mockRejectedValueOnce(new Error('model unavailable'));
    quotaService.loadQuotaStatus.mockResolvedValueOnce({
      ...chatResponse.quota,
      successfulRequestCount: 2,
      remainingCount: 18,
    });
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();

    expect(component.errorMessage()).toBe('Friendly error');
    expect(component.promptControl.value).toBe('How am I today?');
    expect(component.quota()?.remainingCount).toBe(18);
    expect(quotaService.loadQuotaStatus).toHaveBeenCalledTimes(2);
  });

  it('marks quota unavailable when a failed-send refresh returns no status', async () => {
    const existingQuota = {
      ...chatResponse.quota,
      successfulRequestCount: 2,
      remainingCount: 18,
    };
    component.quota.set(existingQuota);
    assistantService.sendMessage.mockRejectedValueOnce(new Error('model unavailable'));
    quotaService.loadQuotaStatus.mockResolvedValueOnce(null);
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();

    expect(component.quota()).toBeNull();
    expect(component.quotaText()).toContain('Allowance status unavailable');
    expect(quotaService.loadQuotaStatus).toHaveBeenCalledTimes(2);
  });

  it('recovers a turn committed before the callable response was lost', async () => {
    let recoveredConversation = chatResponse.conversation;
    assistantService.sendMessage.mockImplementationOnce(async request => {
      recoveredConversation = {
        ...chatResponse.conversation,
        messages: [
          {
            ...chatResponse.conversation.messages[0],
            id: request.requestId,
          },
          chatResponse.conversation.messages[1],
        ],
      };
      assistantService.getConversation.mockResolvedValueOnce(recoveredConversation);
      throw new Error('network response lost');
    });
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();

    expect(component.conversation()).toEqual(recoveredConversation);
    expect(component.promptControl.value).toBe('');
    expect(component.errorMessage()).toBeNull();
    expect(quotaService.loadQuotaStatus).toHaveBeenCalledTimes(2);
  });

  it('recovers a committed turn after bounded history drops the oldest pair', async () => {
    const previousMessages = Array.from({ length: 6 }, (_, index) => ([
      {
        id: `user-${index}`,
        role: 'user' as const,
        text: `Question ${index}`,
        createdAt: '2026-08-03T12:00:00.000Z',
      },
      {
        id: `assistant-${index}`,
        role: 'assistant' as const,
        text: `Answer ${index}`,
        createdAt: '2026-08-03T12:00:00.000Z',
        evidence: [],
      },
    ])).flat();
    const previousConversation = {
      ...chatResponse.conversation,
      messages: previousMessages,
    };
    let refreshedConversation = previousConversation;
    component.conversation.set(previousConversation);
    component.promptControl.setValue('One more question');
    assistantService.sendMessage.mockImplementationOnce(async request => {
      refreshedConversation = {
        ...previousConversation,
        messages: [
          ...previousMessages.slice(2),
          {
            id: request.requestId,
            role: 'user' as const,
            text: 'One more question',
            createdAt: '2026-08-03T12:05:00.000Z',
          },
          {
            id: 'new-assistant',
            role: 'assistant' as const,
            text: 'One more answer',
            createdAt: '2026-08-03T12:05:00.000Z',
            evidence: [],
          },
        ],
      };
      assistantService.getConversation.mockResolvedValueOnce(refreshedConversation);
      throw new Error('network response lost');
    });

    await component.sendMessage();

    expect(component.conversation()).toEqual(refreshedConversation);
    expect(component.promptControl.value).toBe('');
    expect(component.errorMessage()).toBeNull();
  });

  it('does not mistake another completed turn with the same text for its own response', async () => {
    assistantService.sendMessage.mockRejectedValueOnce(new Error('network response lost'));
    assistantService.getConversation.mockResolvedValueOnce(chatResponse.conversation);
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();

    expect(component.conversation()).toEqual(chatResponse.conversation);
    expect(component.promptControl.value).toBe('How am I today?');
    expect(component.errorMessage()).toBe('Friendly error');
  });

  it('recovers its exact turn when another tab committed a later turn', async () => {
    let refreshedConversation = chatResponse.conversation;
    assistantService.sendMessage.mockImplementationOnce(async request => {
      refreshedConversation = {
        ...chatResponse.conversation,
        messages: [
          {
            id: request.requestId,
            role: 'user' as const,
            text: 'How am I today?',
            createdAt: '2026-08-03T12:00:00.000Z',
          },
          chatResponse.conversation.messages[1],
          {
            id: 'other-user',
            role: 'user' as const,
            text: 'What happened later?',
            createdAt: '2026-08-03T12:01:00.000Z',
          },
          {
            id: 'other-assistant',
            role: 'assistant' as const,
            text: 'A later answer.',
            createdAt: '2026-08-03T12:01:00.000Z',
            evidence: [],
          },
        ],
      };
      assistantService.getConversation.mockResolvedValueOnce(refreshedConversation);
      throw new Error('network response lost');
    });
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();

    expect(component.conversation()).toEqual(refreshedConversation);
    expect(component.promptControl.value).toBe('');
    expect(component.errorMessage()).toBeNull();
  });

  it('reuses one request identifier for an ambiguous retry and replaces it for new text', async () => {
    assistantService.sendMessage.mockRejectedValue(new Error('network unavailable'));
    assistantService.getConversation.mockRejectedValue(new Error('reconciliation unavailable'));
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();
    await component.sendMessage();
    component.promptControl.setValue('How was my sleep?');
    await component.sendMessage();

    const requests = assistantService.sendMessage.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(3);
    expect(requests[0].requestId).toBe(requests[1].requestId);
    expect(requests[2].requestId).not.toBe(requests[0].requestId);
  });

  it('reloads a conversation generation changed by another tab', async () => {
    const replacementConversation = {
      ...chatResponse.conversation,
      conversationId: 'conversation-2',
      messages: [],
    };
    assistantService.sendMessage.mockRejectedValueOnce(new AssistantError(
      'CONVERSATION_CHANGED',
      'Conversation changed.',
    ));
    assistantService.getConversation.mockResolvedValueOnce(replacementConversation);
    component.conversation.set(chatResponse.conversation);
    component.promptControl.setValue('Keep this prompt');

    await component.sendMessage();

    expect(component.conversation()).toEqual(replacementConversation);
    expect(component.promptControl.value).toBe('Keep this prompt');
    expect(component.errorMessage()).toContain('It has been refreshed');
    expect(assistantService.getConversation).toHaveBeenCalledTimes(2);
  });

  it('reconciles an authoritative replacement after a generic send failure', async () => {
    const replacementConversation = {
      ...chatResponse.conversation,
      conversationId: 'conversation-2',
      messages: [],
    };
    assistantService.sendMessage.mockRejectedValueOnce(new Error('network unavailable'));
    assistantService.getConversation.mockResolvedValueOnce(replacementConversation);
    component.conversation.set(chatResponse.conversation);
    component.promptControl.setValue('Keep this prompt');

    await component.sendMessage();

    expect(component.conversation()).toEqual(replacementConversation);
    expect(component.promptControl.value).toBe('Keep this prompt');
    expect(component.errorMessage()).toBe('Friendly error');
  });

  it('does not race send or reset against the initial conversation load', async () => {
    component.loadingConversation.set(true);
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();
    await component.resetConversation();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(assistantService.resetConversation).not.toHaveBeenCalled();
  });
});
