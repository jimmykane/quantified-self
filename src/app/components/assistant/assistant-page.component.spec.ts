import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { By } from '@angular/platform-browser';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from 'app/firebase/auth';
import { AppThemes } from '@sports-alliance/sports-lib';
import type { AssistantChatResponse } from '@shared/assistant.types';
import { ASSISTANT_PROMPT_EXAMPLES } from '@shared/assistant.prompts';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import {
  AssistantError,
  AssistantService,
} from '../../services/assistant.service';
import { AssistantExploreBottomSheetComponent } from './assistant-explore-bottom-sheet.component';
import { AssistantPageComponent } from './assistant-page.component';
import { AssistantVisualDetailComponent } from './assistant-visual-detail.component';

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
  pendingRequestId: null,
};

describe('AssistantPageComponent', () => {
  let fixture: ComponentFixture<AssistantPageComponent>;
  let component: AssistantPageComponent;
  const assistantService = {
    getConversationState: vi.fn(),
    sendMessage: vi.fn(),
    resetConversation: vi.fn(),
    getErrorMessage: vi.fn(() => 'Friendly error'),
  };
  const quotaService = {
    loadQuotaStatus: vi.fn(),
  };
  const auth = {
    currentUser: { uid: 'assistant-user' },
  };
  const chart = {
    isDisposed: vi.fn(() => false),
    dispatchAction: vi.fn(),
  };
  const eChartsLoader = {
    init: vi.fn().mockResolvedValue(chart),
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    subscribeToViewportResize: vi.fn(() => vi.fn()),
    attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
  };

  beforeEach(async () => {
    sessionStorage.clear();
    auth.currentUser = { uid: 'assistant-user' };
    assistantService.getConversationState.mockReset().mockResolvedValue({
      conversation: null,
      pendingRequestId: null,
    });
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
        { provide: Auth, useValue: auth },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: EChartsLoaderService, useValue: eChartsLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
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
    expect(sendButton.classList).toContain('mat-mdc-icon-button');
    expect(sendButton.classList).not.toContain('mat-mdc-mini-fab');
    expect(composer.classList).not.toContain('qs-glass-card-panel');
    expect(fixture.nativeElement.querySelector('mat-form-field')).toBeNull();
    const composerFooter = fixture.nativeElement.querySelector('.composer-footer') as HTMLElement;
    expect(composerFooter.textContent)
      .toContain(`0/${component.maxMessageChars}`);
    expect(composerFooter.children).toHaveLength(2);
    expect(composerFooter.textContent).not.toContain('AI can make mistakes');
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe('Ask about your data…');
    expect(textarea.getAttribute('aria-label')).toBe('Ask about your data');
    const autosize = fixture.debugElement.query(By.directive(CdkTextareaAutosize))
      .injector.get(CdkTextareaAutosize);
    expect(autosize.minRows).toBe(1);
    expect(autosize.maxRows).toBe(5);
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

  it('renders deterministic charts but waits for explicit user action before loading maps', async () => {
    const conversation = {
      ...chatResponse.conversation,
      messages: chatResponse.conversation.messages.map(message => (
        message.role === 'assistant' ? {
          ...message,
          visuals: [{
            kind: 'chart' as const,
            title: 'Overnight HRV trend',
            chartType: 'line' as const,
            xAxis: {
              type: 'time' as const,
              label: 'Date',
              unit: null,
              timeZone: 'Europe/Helsinki',
            },
            series: [{
              label: 'Overnight HRV',
              unit: 'ms',
              points: [{ x: '2026-08-03T00:00:00.000Z', y: 52 }],
            }],
          }, {
            kind: 'map' as const,
            title: 'Activity location',
            style: 'user_preference' as const,
            markers: [{
              kind: 'start' as const,
              label: 'Start',
              latitudeDegrees: 39.665,
              longitudeDegrees: 20.853,
            }],
            path: [],
          }],
        } : message
      )),
    };
    component.conversation.set(conversation);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const visualCards = fixture.nativeElement.querySelectorAll('.assistant-visual-card');
    expect(visualCards).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Overnight HRV trend');
    expect(fixture.nativeElement.querySelector('app-assistant-visual-chart')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-assistant-visual-map')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Show map');
    expect(fixture.nativeElement.textContent).toContain('Saved only for Assistant maps.');
    expect(fixture.nativeElement.textContent).toContain(
      'Viewing sends the displayed map area to Mapbox for map tiles.',
    );
    expect(component.activeMapKey()).toBeNull();

    component.showInlineMap('assistant-1:1');
    expect(component.activeMapKey()).toBe('assistant-1:1');
  });

  it('keeps visual expansion to one overlay at a time', () => {
    const closed = new Subject<void>();
    const componentDialog = (component as unknown as {
      dialog: MatDialog;
    }).dialog;
    const openSpy = vi.spyOn(componentDialog, 'open').mockReturnValue({
      afterClosed: () => closed.asObservable(),
    } as never);
    const visual = {
      kind: 'map' as const,
      title: 'Activity location',
      style: 'user_preference' as const,
      markers: [{
        kind: 'start' as const,
        label: 'Start',
        latitudeDegrees: 39.665,
        longitudeDegrees: 20.853,
      }],
      path: [],
    };

    component.openVisual(visual);
    component.openVisual(visual);

    expect(openSpy).toHaveBeenCalledOnce();
    expect(openSpy).toHaveBeenCalledWith(
      AssistantVisualDetailComponent,
      expect.objectContaining({
        ariaLabel: 'Activity location',
        data: { visual },
      }),
    );
    expect(component.visualDetailOpen()).toBe(true);
    expect(component.expandedMap()).toBe(true);

    closed.next();
    expect(component.visualDetailOpen()).toBe(false);
    expect(component.expandedMap()).toBe(false);
    openSpy.mockRestore();
  });

  it('removes the send action while a response is in progress', () => {
    let sendButton = fixture.nativeElement.querySelector(
      '.composer-submit',
    ) as HTMLButtonElement;
    const content = sendButton.querySelector(
      '.composer-submit-content',
    ) as HTMLElement;
    const styles = readFileSync(resolve(
      process.cwd(),
      'src/app/components/assistant/assistant-page.component.scss',
    ), 'utf8');

    expect(sendButton.querySelector('mat-icon')?.textContent).toContain('arrow_upward');
    expect(content).toBeTruthy();

    component.sending.set(true);
    fixture.detectChanges();
    sendButton = fixture.nativeElement.querySelector('.composer-submit') as HTMLButtonElement;
    const composer = fixture.nativeElement.querySelector('.composer') as HTMLElement;

    expect(sendButton).toBeNull();
    expect(composer.classList.contains('composer-sending')).toBe(true);
    expect(styles).toMatch(/\.composer-submit\s*{[^}]*display:\s*grid;/s);
    expect(styles).toMatch(/\.composer-submit\s*{[^}]*place-items:\s*center;/s);
    expect(styles).toMatch(/\.composer-submit\s*{[^}]*width:\s*40px;/s);
    expect(styles).toMatch(/\.composer-submit\s*{[^}]*height:\s*40px;/s);
    expect(styles).toMatch(/\.composer-submit-content\s*{[^}]*position:\s*absolute;/s);
    expect(styles).toMatch(/\.composer-submit-content\s*{[^}]*inset:\s*0;/s);
    expect(styles).toMatch(/\.composer-submit-content\s*{[^}]*place-items:\s*center;/s);
    expect(styles).toMatch(/\.composer-sending\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  });

  it('uses the full chat region for loading without exposing the composer', () => {
    component.loadingConversation.set(true);
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('.assistant-header') as HTMLElement;
    const chat = fixture.nativeElement.querySelector('.assistant-chat') as HTMLElement;
    const loading = fixture.nativeElement.querySelector('.assistant-loading') as HTMLElement;

    expect(header.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(chat.contains(loading)).toBe(true);
    expect(fixture.nativeElement.querySelector('.composer-shell')).toBeNull();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('follows an in-flight server turn after refresh until its answer is saved', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequestId = 'assistant-request-refresh-0001';
      const pendingConversation = {
        ...chatResponse.conversation,
        messages: [],
      };
      const completedConversation = {
        ...pendingConversation,
        messages: [
          {
            id: pendingRequestId,
            role: 'user' as const,
            text: 'How am I today?',
            createdAt: '2026-08-03T12:00:00.000Z',
          },
          {
            id: 'assistant-refresh-response',
            role: 'assistant' as const,
            text: 'Your refreshed answer is ready.',
            createdAt: '2026-08-03T12:00:01.000Z',
            evidence: [],
          },
        ],
      };
      sessionStorage.setItem(
        'quantified-self.assistant.pending-request-id',
        JSON.stringify({
          storageVersion: 2,
          uid: 'assistant-user',
          requestId: pendingRequestId,
          message: 'How am I today?',
          timeZone: 'Europe/Helsinki',
          submittedAtMs: Date.now(),
        }),
      );
      assistantService.getConversationState.mockReset()
        .mockResolvedValueOnce({
          conversation: pendingConversation,
          pendingRequestId,
        })
        .mockResolvedValueOnce({
          conversation: completedConversation,
          pendingRequestId: null,
        });

      await component.ngOnInit();
      fixture.detectChanges();

      expect(component.sending()).toBe(true);
      expect(component.messages().at(-1)).toMatchObject({
        id: pendingRequestId,
        role: 'user',
        text: 'How am I today?',
      });
      expect(fixture.nativeElement.textContent).toContain(
        'Checking the relevant Quantified Self data',
      );
      expect(fixture.nativeElement.textContent).toContain('How am I today?');

      await vi.advanceTimersByTimeAsync(2_000);
      fixture.detectChanges();

      expect(component.sending()).toBe(false);
      expect(component.conversation()).toEqual(completedConversation);
      expect(component.errorMessage()).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Your refreshed answer is ready.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resubmits and renders a stored question when refresh beats server registration', async () => {
    const pendingRequestId = 'assistant-request-cancelled-before-registration';
    const submittedAtMs = Date.now();
    let resolveSend: ((response: AssistantChatResponse) => void) | undefined;
    assistantService.getConversationState.mockReset().mockResolvedValueOnce({
      conversation: null,
      pendingRequestId: null,
    });
    assistantService.sendMessage.mockReset().mockReturnValueOnce(new Promise(
      resolve => {
        resolveSend = resolve;
      },
    ));
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'assistant-user',
        requestId: pendingRequestId,
        message: 'How has my sleep changed?',
        timeZone: 'Europe/Helsinki',
        submittedAtMs,
      }),
    );

    await component.ngOnInit();
    fixture.detectChanges();

    expect(assistantService.sendMessage).toHaveBeenCalledWith({
      requestId: pendingRequestId,
      message: 'How has my sleep changed?',
      timeZone: 'Europe/Helsinki',
      locationAccess: 'coordinate_free',
    });
    expect(component.sending()).toBe(true);
    expect(component.messages().at(-1)).toMatchObject({
      id: pendingRequestId,
      role: 'user',
      text: 'How has my sleep changed?',
    });
    expect(fixture.nativeElement.textContent).toContain('How has my sleep changed?');
    expect(JSON.parse(sessionStorage.getItem(
      'quantified-self.assistant.pending-request-id',
    ) || '{}')).toMatchObject({ submittedAtMs });

    resolveSend?.({
      ...chatResponse,
      conversation: {
        ...chatResponse.conversation,
        messages: [
          {
            ...chatResponse.conversation.messages[0],
            id: pendingRequestId,
            text: 'How has my sleep changed?',
          },
          chatResponse.conversation.messages[1],
        ],
      },
    });
    await vi.waitFor(() => expect(component.sending()).toBe(false));

    expect(sessionStorage.getItem(
      'quantified-self.assistant.pending-request-id',
    )).toBeNull();
  });

  it('polls the original turn without a conflict when a resumed request loses registration', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequestId = 'assistant-request-original-won-registration';
      const pendingConversation = {
        ...chatResponse.conversation,
        messages: [],
      };
      const completedConversation = {
        ...chatResponse.conversation,
        messages: [
          {
            id: pendingRequestId,
            role: 'user' as const,
            text: 'How has my sleep changed?',
            createdAt: '2026-08-03T12:00:00.000Z',
          },
          chatResponse.conversation.messages[1],
        ],
      };
      assistantService.sendMessage.mockReset().mockResolvedValueOnce({
        ...chatResponse,
        conversation: pendingConversation,
        pendingRequestId,
      });
      assistantService.getConversationState.mockReset()
        .mockResolvedValueOnce({
          conversation: null,
          pendingRequestId: null,
        })
        .mockResolvedValueOnce({
          conversation: completedConversation,
          pendingRequestId: null,
        });
      sessionStorage.setItem(
        'quantified-self.assistant.pending-request-id',
        JSON.stringify({
          storageVersion: 2,
          uid: 'assistant-user',
          requestId: pendingRequestId,
          message: 'How has my sleep changed?',
          timeZone: 'Europe/Helsinki',
          submittedAtMs: Date.now(),
        }),
      );

      await component.ngOnInit();

      expect(component.sending()).toBe(true);
      expect(component.errorMessage()).toBeNull();
      expect(component.messages().at(-1)?.text).toBe('How has my sleep changed?');
      expect(assistantService.sendMessage).toHaveBeenCalledWith({
        requestId: pendingRequestId,
        message: 'How has my sleep changed?',
        timeZone: 'Europe/Helsinki',
        locationAccess: 'coordinate_free',
      });
      expect(assistantService.getConversationState).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(2_000);

      expect(component.sending()).toBe(false);
      expect(component.conversation()).toEqual(completedConversation);
      expect(component.errorMessage()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a first request after it created an empty conversation generation', async () => {
    const pendingRequestId = 'assistant-request-created-empty-conversation';
    const createdConversation = {
      ...chatResponse.conversation,
      messages: [],
    };
    assistantService.getConversationState.mockReset().mockResolvedValueOnce({
      conversation: createdConversation,
      pendingRequestId: null,
    });
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'assistant-user',
        requestId: pendingRequestId,
        message: 'How has my recovery changed?',
        timeZone: 'Europe/Helsinki',
        submittedAtMs: Date.now(),
      }),
    );

    await component.ngOnInit();

    expect(assistantService.sendMessage).toHaveBeenCalledWith({
      requestId: pendingRequestId,
      message: 'How has my recovery changed?',
      timeZone: 'Europe/Helsinki',
      locationAccess: 'coordinate_free',
      conversationId: createdConversation.conversationId,
    });
  });

  it('does not move a first request into a populated conversation generation', async () => {
    const pendingRequestId = 'assistant-request-before-generation-change';
    assistantService.getConversationState.mockReset().mockResolvedValueOnce({
      conversation: chatResponse.conversation,
      pendingRequestId: null,
    });
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'assistant-user',
        requestId: pendingRequestId,
        message: 'Keep this question safe',
        timeZone: 'Europe/Helsinki',
        submittedAtMs: Date.now(),
      }),
    );

    await component.ngOnInit();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(component.promptControl.value).toBe('Keep this question safe');
    expect(component.errorMessage()).toContain('could not be resumed');
  });

  it('resumes a follow-up request only in its matching conversation generation', async () => {
    const pendingRequestId = 'assistant-follow-up-matching-generation';
    assistantService.getConversationState.mockReset().mockResolvedValueOnce({
      conversation: chatResponse.conversation,
      pendingRequestId: null,
    });
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'assistant-user',
        requestId: pendingRequestId,
        message: 'What contributed to that?',
        timeZone: 'Europe/Helsinki',
        conversationId: chatResponse.conversation.conversationId,
        submittedAtMs: Date.now(),
      }),
    );

    await component.ngOnInit();

    expect(assistantService.sendMessage).toHaveBeenCalledWith({
      requestId: pendingRequestId,
      message: 'What contributed to that?',
      timeZone: 'Europe/Helsinki',
      locationAccess: 'coordinate_free',
      conversationId: chatResponse.conversation.conversationId,
    });
  });

  it('does not resend a follow-up request after its conversation generation changed', async () => {
    const pendingRequestId = 'assistant-follow-up-changed-generation';
    assistantService.getConversationState.mockReset().mockResolvedValueOnce({
      conversation: chatResponse.conversation,
      pendingRequestId: null,
    });
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'assistant-user',
        requestId: pendingRequestId,
        message: 'Do not cross the reset',
        timeZone: 'Europe/Helsinki',
        conversationId: 'replaced-conversation-generation',
        submittedAtMs: Date.now(),
      }),
    );

    await component.ngOnInit();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(component.promptControl.value).toBe('Do not cross the reset');
    expect(component.errorMessage()).toContain('could not be resumed');
  });

  it('discards a pending question created by a different signed-in account', async () => {
    const pendingRequestId = 'assistant-request-from-previous-account';
    assistantService.getConversationState.mockReset().mockResolvedValueOnce({
      conversation: null,
      pendingRequestId: null,
    });
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'previous-account',
        requestId: pendingRequestId,
        message: 'A private question from the previous account',
        timeZone: 'Europe/Helsinki',
        submittedAtMs: Date.now(),
      }),
    );

    await component.ngOnInit();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(component.promptControl.value).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain(
      'A private question from the previous account',
    );
    expect(sessionStorage.getItem(
      'quantified-self.assistant.pending-request-id',
    )).toBeNull();
  });

  it('discards initialization results when the signed-in account changes mid-load', async () => {
    const pendingRequestId = 'assistant-request-during-account-switch';
    let resolveConversationState: ((value: {
      conversation: typeof chatResponse.conversation;
      pendingRequestId: null;
    }) => void) | undefined;
    assistantService.getConversationState.mockReset().mockReturnValueOnce(new Promise(
      resolve => {
        resolveConversationState = resolve;
      },
    ));
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'assistant-user',
        requestId: pendingRequestId,
        message: 'Do not show this after switching accounts',
        timeZone: 'Europe/Helsinki',
        submittedAtMs: Date.now(),
      }),
    );

    const initialization = component.ngOnInit();
    auth.currentUser = { uid: 'replacement-user' };
    resolveConversationState?.({
      conversation: chatResponse.conversation,
      pendingRequestId: null,
    });
    await initialization;

    expect(component.conversation()).toBeNull();
    expect(component.quota()).toBeNull();
    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(component.promptControl.value).toBe('');
    expect(sessionStorage.getItem(
      'quantified-self.assistant.pending-request-id',
    )).toBeNull();
  });

  it('persists a bounded resumable request only while its result is ambiguous', async () => {
    let resolveSend: ((response: AssistantChatResponse) => void) | undefined;
    assistantService.sendMessage.mockReset().mockReturnValueOnce(new Promise(
      resolve => {
        resolveSend = resolve;
      },
    ));
    component.promptControl.setValue('How am I today?');

    const sendPromise = component.sendMessage();
    const storedRequest = JSON.parse(sessionStorage.getItem(
      'quantified-self.assistant.pending-request-id',
    ) || '{}') as Record<string, unknown>;

    expect(storedRequest).toMatchObject({
      storageVersion: 2,
      uid: 'assistant-user',
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{16,120}$/),
      message: 'How am I today?',
      timeZone: expect.any(String),
      locationAccess: 'coordinate_free',
      submittedAtMs: expect.any(Number),
    });

    resolveSend?.(chatResponse);
    await sendPromise;

    expect(sessionStorage.getItem(
      'quantified-self.assistant.pending-request-id',
    )).toBeNull();
  });

  it('does not automatically resend a stale stored question', async () => {
    const pendingRequestId = 'assistant-request-stale-before-registration';
    assistantService.getConversationState.mockReset().mockResolvedValueOnce({
      conversation: null,
      pendingRequestId: null,
    });
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      JSON.stringify({
        storageVersion: 2,
        uid: 'assistant-user',
        requestId: pendingRequestId,
        message: 'How was my old week?',
        timeZone: 'Europe/Helsinki',
        submittedAtMs: Date.now() - (5 * 60 * 1_000),
      }),
    );

    await component.ngOnInit();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(component.promptControl.value).toBe('How was my old week?');
    expect(component.errorMessage()).toBe(
      'Your previous question could not be resumed. It is ready for you to send again.',
    );
    expect(sessionStorage.getItem(
      'quantified-self.assistant.pending-request-id',
    )).toBeNull();
  });

  it('survives a refresh that reaches the server before the pending turn is registered', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequestId = 'assistant-request-registration-race';
      const pendingConversation = {
        ...chatResponse.conversation,
        messages: [],
      };
      const completedConversation = {
        ...pendingConversation,
        messages: [
          {
            id: pendingRequestId,
            role: 'user' as const,
            text: 'How am I today?',
            createdAt: '2026-08-03T12:00:00.000Z',
          },
          {
            id: 'assistant-registration-race-response',
            role: 'assistant' as const,
            text: 'The interrupted answer is ready.',
            createdAt: '2026-08-03T12:00:01.000Z',
            evidence: [],
          },
        ],
      };
      sessionStorage.setItem(
        'quantified-self.assistant.pending-request-id',
        pendingRequestId,
      );
      assistantService.getConversationState.mockReset()
        .mockResolvedValueOnce({
          conversation: pendingConversation,
          pendingRequestId: null,
        })
        .mockResolvedValueOnce({
          conversation: pendingConversation,
          pendingRequestId,
        })
        .mockResolvedValueOnce({
          conversation: completedConversation,
          pendingRequestId: null,
        });

      await component.ngOnInit();
      expect(component.sending()).toBe(true);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(component.sending()).toBe(true);
      expect(component.errorMessage()).toBeNull();

      await vi.advanceTimersByTimeAsync(3_000);

      expect(component.sending()).toBe(false);
      expect(component.conversation()).toEqual(completedConversation);
      expect(sessionStorage.getItem('quantified-self.assistant.pending-request-id')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed initial state read for a remembered in-flight request', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequestId = 'assistant-request-initial-read-retry';
      const pendingConversation = {
        ...chatResponse.conversation,
        messages: [],
      };
      const completedConversation = {
        ...pendingConversation,
        messages: [
          {
            id: pendingRequestId,
            role: 'user' as const,
            text: 'How am I today?',
            createdAt: '2026-08-03T12:00:00.000Z',
          },
          {
            id: 'assistant-initial-read-retry-response',
            role: 'assistant' as const,
            text: 'The recovered answer is ready.',
            createdAt: '2026-08-03T12:00:01.000Z',
            evidence: [],
          },
        ],
      };
      sessionStorage.setItem(
        'quantified-self.assistant.pending-request-id',
        pendingRequestId,
      );
      assistantService.getConversationState.mockReset()
        .mockRejectedValueOnce(new Error('temporary state read failure'))
        .mockResolvedValueOnce({
          conversation: pendingConversation,
          pendingRequestId,
        })
        .mockResolvedValueOnce({
          conversation: completedConversation,
          pendingRequestId: null,
        });

      await component.ngOnInit();

      expect(component.sending()).toBe(true);
      expect(component.errorMessage()).toBeNull();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(component.sending()).toBe(false);
      expect(component.conversation()).toEqual(completedConversation);
      expect(component.errorMessage()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off pending-turn polling while keeping it bounded', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequestId = 'assistant-request-progressive-polling';
      const pendingConversation = {
        ...chatResponse.conversation,
        messages: [],
      };
      assistantService.getConversationState.mockReset().mockResolvedValue({
        conversation: pendingConversation,
        pendingRequestId,
      });

      await component.ngOnInit();
      await vi.advanceTimersByTimeAsync(20_000);

      // Initial load, then polls after 2s, 3s, 4.5s, 5s, and 5s.
      expect(assistantService.getConversationState).toHaveBeenCalledTimes(6);
      expect(component.sending()).toBe(true);
    } finally {
      component.ngOnDestroy();
      vi.useRealTimers();
    }
  });

  it('restores the exact question when the server ends a turn without an answer', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequestId = 'assistant-request-generation-failed';
      const pendingConversation = {
        ...chatResponse.conversation,
        messages: [],
      };
      sessionStorage.setItem(
        'quantified-self.assistant.pending-request-id',
        JSON.stringify({
          storageVersion: 2,
          uid: 'assistant-user',
          requestId: pendingRequestId,
          message: 'How has my sleep changed?',
          timeZone: 'Europe/Helsinki',
          submittedAtMs: Date.now(),
        }),
      );
      assistantService.getConversationState.mockReset()
        .mockResolvedValueOnce({
          conversation: pendingConversation,
          pendingRequestId,
        })
        .mockResolvedValueOnce({
          conversation: pendingConversation,
          pendingRequestId: null,
        });

      await component.ngOnInit();
      expect(component.messages().at(-1)?.text).toBe('How has my sleep changed?');

      await vi.advanceTimersByTimeAsync(2_000);

      expect(component.sending()).toBe(false);
      expect(component.promptControl.value).toBe('How has my sleep changed?');
      expect(component.errorMessage()).toBe(
        'The Assistant could not answer this question. It is ready below to send again.',
      );
      expect(component.errorMessage()).not.toContain('previous Assistant request');
      expect(sessionStorage.getItem(
        'quantified-self.assistant.pending-request-id',
      )).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops pending-turn polling when the state read fails permanently', async () => {
    vi.useFakeTimers();
    try {
      const pendingRequestId = 'assistant-request-permanent-read-failure';
      assistantService.getConversationState.mockReset()
        .mockResolvedValueOnce({
          conversation: null,
          pendingRequestId,
        })
        .mockRejectedValueOnce(new AssistantError(
          'UNAUTHENTICATED',
          'Authentication required.',
        ));
      assistantService.getErrorMessage.mockReturnValueOnce(
        'Sign in before using the Assistant.',
      );

      await component.ngOnInit();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(component.sending()).toBe(false);
      expect(component.errorMessage()).toBe('Sign in before using the Assistant.');
      expect(assistantService.getConversationState).toHaveBeenCalledTimes(2);
      expect(sessionStorage.getItem('quantified-self.assistant.pending-request-id')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks the composer and offers retry after an initial state failure', async () => {
    const pendingRequestId = 'assistant-request-initial-permanent-failure';
    sessionStorage.setItem(
      'quantified-self.assistant.pending-request-id',
      pendingRequestId,
    );
    assistantService.getConversationState.mockReset().mockRejectedValueOnce(
      new AssistantError('PERMISSION_DENIED', 'Assistant access denied.'),
    );
    assistantService.getErrorMessage.mockReturnValueOnce(
      'The Assistant is unavailable for this account.',
    );

    await component.ngOnInit();
    fixture.detectChanges();

    expect(component.sending()).toBe(false);
    expect(component.errorMessage()).toBeNull();
    expect(component.conversationLoadError()).toBe(
      'The Assistant is unavailable for this account.',
    );
    expect(assistantService.getConversationState).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('quantified-self.assistant.pending-request-id')).toBeNull();
    expect(fixture.nativeElement.querySelector('.assistant-load-error')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Conversation unavailable');
    expect(fixture.nativeElement.querySelector('.composer-shell')).toBeNull();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    component.promptControl.setValue('This must not send');

    await component.sendMessage();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();

    assistantService.getConversationState.mockResolvedValueOnce({
      conversation: null,
      pendingRequestId: null,
    });

    await component.retryConversationLoad();
    fixture.detectChanges();

    expect(component.conversationLoadError()).toBeNull();
    expect(fixture.nativeElement.querySelector('.assistant-load-error')).toBeNull();
    expect(fixture.nativeElement.querySelector('.composer-shell')).toBeTruthy();
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
      afterDismissed: () => of({ kind: 'prompt', prompt: routeExample.prompt }),
    } as never);

    component.openExploreSheet();

    expect(openSpy).toHaveBeenCalledWith(AssistantExploreBottomSheetComponent, {
      data: { locationAccess: 'coordinate_free' },
    });
    expect(component.promptControl.value).toBe(routeExample.prompt);
    openSpy.mockRestore();
  });

  it('starts a fresh chat when precise activity locations are enabled', async () => {
    component.promptControl.setValue('Where was my biggest MTB jump?');
    const componentBottomSheet = (component as unknown as {
      bottomSheet: MatBottomSheet;
    }).bottomSheet;
    const openSpy = vi.spyOn(componentBottomSheet, 'open').mockReturnValue({
      afterDismissed: () => of({
        kind: 'location_access',
        locationAccess: 'precise_activity',
      }),
    } as never);

    component.openExploreSheet();
    await vi.waitFor(() => {
      expect(assistantService.resetConversation).toHaveBeenCalledWith(
        'precise_activity',
      );
    });
    fixture.detectChanges();

    expect(component.locationAccess()).toBe('precise_activity');
    expect(component.promptControl.value).toBe('Where was my biggest MTB jump?');
    expect(fixture.nativeElement.textContent).toContain('Precise locations on');
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
    assistantService.getConversationState.mockResolvedValueOnce({
      conversation: null,
      pendingRequestId: null,
    });

    await component.ngOnInit();

    expect(scrollSpy).not.toHaveBeenCalled();

    assistantService.getConversationState.mockResolvedValueOnce({
      conversation: chatResponse.conversation,
      pendingRequestId: null,
    });
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
    expect(text).toContain('Data used');
    expect(fixture.nativeElement.querySelector('.evidence-count')?.textContent.trim()).toBe('1');
    expect(text).toContain('Get daily report');
    const evidenceCard = fixture.nativeElement.querySelector('.evidence-item') as HTMLElement;
    expect(evidenceCard.tagName).toBe('MAT-CARD');
    expect(evidenceCard.querySelector('.evidence-source-copy strong')?.textContent)
      .toContain('Get daily report');
    expect(evidenceCard.querySelector('.evidence-source-copy > span')?.textContent)
      .toContain('Grounded in Get daily report.');
    expect(text).toContain('19 of 20 remaining');
  });

  it('starts a new server-owned conversation', async () => {
    component.conversation.set(chatResponse.conversation);
    component.locationAccess.set('precise_activity');

    await component.resetConversation();

    expect(assistantService.resetConversation).toHaveBeenCalledWith('coordinate_free');
    expect(component.messages()).toEqual([]);
    expect(component.locationAccess()).toBe('coordinate_free');
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
      assistantService.getConversationState.mockResolvedValueOnce({
        conversation: recoveredConversation,
        pendingRequestId: null,
      });
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
      assistantService.getConversationState.mockResolvedValueOnce({
        conversation: refreshedConversation,
        pendingRequestId: null,
      });
      throw new Error('network response lost');
    });

    await component.sendMessage();

    expect(component.conversation()).toEqual(refreshedConversation);
    expect(component.promptControl.value).toBe('');
    expect(component.errorMessage()).toBeNull();
  });

  it('does not mistake another completed turn with the same text for its own response', async () => {
    assistantService.sendMessage.mockRejectedValueOnce(new Error('network response lost'));
    assistantService.getConversationState.mockResolvedValueOnce({
      conversation: chatResponse.conversation,
      pendingRequestId: null,
    });
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
      assistantService.getConversationState.mockResolvedValueOnce({
        conversation: refreshedConversation,
        pendingRequestId: null,
      });
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
    assistantService.getConversationState.mockRejectedValue(new Error('reconciliation unavailable'));
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
    assistantService.getConversationState.mockResolvedValueOnce({
      conversation: createdConversation,
      pendingRequestId: null,
    });
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
    assistantService.getConversationState.mockResolvedValueOnce({
      conversation: replacementConversation,
      pendingRequestId: null,
    });
    component.conversation.set(chatResponse.conversation);
    component.promptControl.setValue('Keep this prompt');

    await component.sendMessage();

    expect(component.conversation()).toEqual(replacementConversation);
    expect(component.promptControl.value).toBe('Keep this prompt');
    expect(component.errorMessage()).toContain('It has been refreshed');
    expect(assistantService.getConversationState).toHaveBeenCalledTimes(2);
  });

  it('reconciles an authoritative replacement after a generic send failure', async () => {
    const replacementConversation = {
      ...chatResponse.conversation,
      conversationId: 'conversation-2',
      messages: [],
    };
    assistantService.sendMessage.mockRejectedValueOnce(new Error('network unavailable'));
    assistantService.getConversationState.mockResolvedValueOnce({
      conversation: replacementConversation,
      pendingRequestId: null,
    });
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
