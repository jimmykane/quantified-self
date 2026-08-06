import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantChatResponse } from '@shared/assistant.types';
import {
  ASSISTANT_COMPOSER_EXAMPLE_PROMPT,
  ASSISTANT_PROMPT_EXAMPLES,
} from '@shared/assistant.prompts';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import {
  AssistantError,
  AssistantService,
} from '../../services/assistant.service';
import { AssistantExploreBottomSheetComponent } from './assistant-explore-bottom-sheet.component';
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

  it('renders a minimal empty chat with an optional explore control', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Assistant');
    expect(text).toContain('Examples & data access');
    expect(fixture.nativeElement.querySelector('mat-chip')).toBeNull();
    expect(fixture.nativeElement.querySelector('.assistant-heading-icon')).toBeNull();
    expect(fixture.nativeElement.querySelector('.assistant-header p')).toBeNull();
    expect(fixture.nativeElement.querySelector('.assistant-welcome')).toBeNull();
    expect(fixture.nativeElement.querySelector('.assistant-trust-row')).toBeNull();
    expect(fixture.nativeElement.querySelector('.external-mcp-card')).toBeNull();
    const header = fixture.nativeElement.querySelector('.assistant-header') as HTMLElement;
    const chat = fixture.nativeElement.querySelector('.assistant-chat') as HTMLElement;
    const composer = fixture.nativeElement.querySelector('.composer-shell') as HTMLElement;
    const explore = fixture.nativeElement.querySelector('.assistant-explore-trigger') as HTMLElement;
    expect(header.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(header.contains(explore)).toBe(true);
    expect(chat.contains(explore)).toBe(false);
    expect(chat.contains(composer)).toBe(true);
    expect(header.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    const sendButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(sendButton.textContent).not.toContain('Send');
    expect(sendButton.getAttribute('aria-label')).toBe('Send message');
    expect(fixture.nativeElement.querySelector('mat-hint')).toBeNull();
    const composerFooter = fixture.nativeElement.querySelector('.composer-footer') as HTMLElement;
    expect(composerFooter.textContent)
      .toContain(`0/${component.maxMessageChars}`);
    expect(composerFooter.children).toHaveLength(2);
    expect(composerFooter.textContent).not.toContain('AI can make mistakes');
    expect(fixture.nativeElement.querySelector('textarea')?.placeholder)
      .toBe(`For example: ${ASSISTANT_COMPOSER_EXAMPLE_PROMPT}`);
    const headerActions = Array.from(
      fixture.nativeElement.querySelectorAll('.assistant-header-actions :is(a, button)'),
    ) as HTMLElement[];
    expect(headerActions).toHaveLength(2);
    expect(headerActions.map(action => action.textContent?.trim())).toEqual([
      'help_outline',
      'add_comment',
    ]);
  });

  it('uses the full chat region for conversation content above the docked composer', () => {
    component.conversation.set(chatResponse.conversation);
    fixture.detectChanges();
    const chat = fixture.nativeElement.querySelector('.assistant-chat') as HTMLElement;
    const conversation = fixture.nativeElement.querySelector('.conversation') as HTMLElement;
    const dock = fixture.nativeElement.querySelector('.assistant-composer-dock') as HTMLElement;
    const composer = fixture.nativeElement.querySelector('.composer-shell') as HTMLElement;

    expect(chat.contains(conversation)).toBe(true);
    expect(chat.contains(dock)).toBe(true);
    expect(dock.contains(composer)).toBe(true);
    expect(conversation.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('keeps loading state inside the full chat region above the composer', () => {
    component.loadingConversation.set(true);
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('.assistant-header') as HTMLElement;
    const chat = fixture.nativeElement.querySelector('.assistant-chat') as HTMLElement;
    const composer = fixture.nativeElement.querySelector('.composer-shell') as HTMLElement;
    const loading = fixture.nativeElement.querySelector('.assistant-loading') as HTMLElement;

    expect(header.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(chat.contains(loading)).toBe(true);
    expect(chat.contains(composer)).toBe(true);
    expect(loading.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it('opens the explore sheet and inserts a selected example', () => {
    const routeExample = ASSISTANT_PROMPT_EXAMPLES.find(example => (
      example.id === 'saved-cycling-routes'
    ));
    if (!routeExample) {
      throw new Error('Expected the saved-route prompt example.');
    }
    const componentBottomSheet = (component as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    const openSpy = vi.spyOn(componentBottomSheet, 'open').mockReturnValue({
      afterDismissed: () => of(routeExample.prompt),
    } as never);

    component.openExploreSheet();

    expect(openSpy).toHaveBeenCalledWith(AssistantExploreBottomSheetComponent);
    expect(component.promptControl.value).toBe(routeExample.prompt);
    openSpy.mockRestore();
  });

  it('cancels native form navigation before sending', async () => {
    component.promptControl.setValue('How am I today?');
    fixture.detectChanges();
    const submitEvent = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
    });
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    const dispatchResult = form.dispatchEvent(submitEvent);
    await fixture.whenStable();

    expect(dispatchResult).toBe(false);
    expect(submitEvent.defaultPrevented).toBe(true);
    expect(assistantService.sendMessage).toHaveBeenCalledOnce();
  });

  it('does not auto-scroll an empty initial conversation', async () => {
    const scrollSpy = vi.spyOn(
      component as unknown as { scrollToConversationEnd: () => void },
      'scrollToConversationEnd',
    );
    assistantService.getConversation.mockResolvedValueOnce(null);

    await component.ngOnInit();

    expect(scrollSpy).not.toHaveBeenCalled();

    assistantService.getConversation.mockResolvedValueOnce(chatResponse.conversation);
    await component.ngOnInit();

    expect(scrollSpy).toHaveBeenCalledOnce();
  });

  it('returns an empty first-turn failure to the page start', async () => {
    const scrollEndSpy = vi.spyOn(
      component as unknown as { scrollToConversationEnd: () => void },
      'scrollToConversationEnd',
    );
    const scrollStartSpy = vi.spyOn(
      component as unknown as { scrollToPageStart: () => void },
      'scrollToPageStart',
    );
    assistantService.sendMessage.mockRejectedValueOnce(new Error('model unavailable'));
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();

    expect(scrollEndSpy).not.toHaveBeenCalled();
    expect(scrollStartSpy).toHaveBeenCalledOnce();
  });

  it('keeps a send error in the dock above the composer', () => {
    component.errorMessage.set('Something went wrong while preparing the answer.');
    fixture.detectChanges();
    const dock = fixture.nativeElement.querySelector('.assistant-composer-dock') as HTMLElement;
    const composer = fixture.nativeElement.querySelector('.composer-shell') as HTMLElement;
    const error = fixture.nativeElement.querySelector('.assistant-error') as HTMLElement;
    const dismiss = error.querySelector('button') as HTMLButtonElement;

    expect(error).toBeTruthy();
    expect(error.parentElement).toBe(dock);
    expect(error.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss Assistant error');
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
    expect(text).toContain('19 of 20 remaining');
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
    expect(component.quotaText()).toBe('Allowance checked when you send');
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

  it('retries the first request after it consumed the final quota slot', async () => {
    const createdConversation = {
      ...chatResponse.conversation,
      messages: [],
    };
    const exhaustedQuota = {
      ...chatResponse.quota,
      successfulRequestCount: chatResponse.quota.limit,
      remainingCount: 0,
      blockedReason: 'limit_reached' as const,
    };
    assistantService.sendMessage
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        ...chatResponse,
        quota: exhaustedQuota,
      });
    assistantService.getConversation.mockResolvedValueOnce(createdConversation);
    quotaService.loadQuotaStatus.mockResolvedValueOnce(exhaustedQuota);
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();
    fixture.detectChanges();

    expect(component.quota()?.remainingCount).toBe(0);
    expect(fixture.nativeElement.querySelector('button[type="submit"]')?.disabled)
      .toBe(false);

    component.promptControl.setValue('Ask a different question');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]')?.disabled)
      .toBe(true);

    component.promptControl.setValue('How am I today?');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]')?.disabled)
      .toBe(false);

    await component.sendMessage();

    const requests = assistantService.sendMessage.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests[0].conversationId).toBeUndefined();
    expect(requests[1].conversationId).toBe(createdConversation.conversationId);
    expect(requests[1].requestId).toBe(requests[0].requestId);
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
