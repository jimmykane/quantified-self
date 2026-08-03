import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantChatResponse } from '@shared/assistant.types';
import { AiInsightsQuotaService } from '../../services/ai-insights-quota.service';
import { AssistantService } from '../../services/assistant.service';
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
        { provide: AiInsightsQuotaService, useValue: quotaService },
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
    expect(fixture.nativeElement.querySelector('.assistant-welcome')?.classList)
      .toContain('qs-glass-card-panel');
  });

  it('sends a starter prompt and renders the grounded response evidence', async () => {
    component.useStarterPrompt("Give me today's sleep, readiness, and Training report.");
    await component.sendMessage();
    fixture.detectChanges();

    expect(assistantService.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "Give me today's sleep, readiness, and Training report.",
    }));
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Your readiness is 72 today.');
    expect(text).toContain('1 grounded source');
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

  it('does not race send or reset against the initial conversation load', async () => {
    component.loadingConversation.set(true);
    component.promptControl.setValue('How am I today?');

    await component.sendMessage();
    await component.resetConversation();

    expect(assistantService.sendMessage).not.toHaveBeenCalled();
    expect(assistantService.resetConversation).not.toHaveBeenCalled();
  });
});
