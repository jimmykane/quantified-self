import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ASSISTANT_MAX_MESSAGE_CHARS,
  type AssistantConversation,
  type AssistantMessage,
} from '@shared/assistant.types';
import type { AiInsightsQuotaStatus } from '@shared/ai-insights.types';
import { ASSISTANT_STARTER_PROMPTS } from '@shared/assistant.prompts';
import { MaterialModule } from '../../modules/material.module';
import { AiInsightsQuotaService } from '../../services/ai-insights-quota.service';
import { AssistantService } from '../../services/assistant.service';

@Component({
  selector: 'app-assistant-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MaterialModule,
  ],
  templateUrl: './assistant-page.component.html',
  styleUrls: ['./assistant-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPageComponent implements OnInit {
  private readonly assistantService = inject(AssistantService);
  private readonly quotaService = inject(AiInsightsQuotaService);
  private readonly conversationEnd = viewChild<ElementRef<HTMLElement>>('conversationEnd');

  readonly maxMessageChars = ASSISTANT_MAX_MESSAGE_CHARS;
  readonly starterPrompts = ASSISTANT_STARTER_PROMPTS;
  readonly promptControl = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.maxLength(ASSISTANT_MAX_MESSAGE_CHARS),
    ],
  });
  readonly conversation = signal<AssistantConversation | null>(null);
  readonly pendingUserMessage = signal<AssistantMessage | null>(null);
  readonly quota = signal<AiInsightsQuotaStatus | null>(null);
  readonly loadingConversation = signal(true);
  readonly sending = signal(false);
  readonly resetting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly messages = computed(() => {
    const storedMessages = this.conversation()?.messages || [];
    const pendingMessage = this.pendingUserMessage();
    return pendingMessage
      ? [...storedMessages, pendingMessage]
      : storedMessages;
  });
  readonly isEmpty = computed(() => this.messages().length === 0);
  readonly quotaBlocked = computed(() => {
    const status = this.quota();
    return status !== null
      && (!status.isEligible || status.remainingCount <= 0);
  });
  readonly quotaText = computed(() => {
    const status = this.quota();
    if (!status) {
      return '';
    }
    return `${status.remainingCount} of ${status.limit} Assistant requests remaining`;
  });

  async ngOnInit(): Promise<void> {
    const [conversationResult, quotaResult] = await Promise.allSettled([
      this.assistantService.getConversation(),
      this.quotaService.loadQuotaStatus(),
    ]);
    if (conversationResult.status === 'fulfilled') {
      this.conversation.set(conversationResult.value);
    } else {
      this.errorMessage.set(this.assistantService.getErrorMessage(conversationResult.reason));
    }
    if (quotaResult.status === 'fulfilled') {
      this.quota.set(quotaResult.value);
    }
    this.loadingConversation.set(false);
    this.scrollToConversationEnd();
  }

  useStarterPrompt(prompt: string): void {
    this.promptControl.setValue(prompt);
    this.promptControl.markAsDirty();
  }

  async sendMessage(): Promise<void> {
    if (this.loadingConversation()
      || this.sending()
      || this.quotaBlocked()
      || this.promptControl.invalid) {
      this.promptControl.markAsTouched();
      return;
    }
    const text = this.promptControl.value.trim();
    if (!text) {
      return;
    }
    this.errorMessage.set(null);
    this.sending.set(true);
    this.pendingUserMessage.set({
      id: 'pending-user-message',
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    });
    this.promptControl.setValue('');
    this.scrollToConversationEnd();
    try {
      const activeConversation = this.conversation();
      const response = await this.assistantService.sendMessage({
        message: text,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        ...(activeConversation?.conversationId
          ? { conversationId: activeConversation.conversationId }
          : {}),
      });
      this.conversation.set(response.conversation);
      this.quota.set(response.quota);
    } catch (error) {
      this.errorMessage.set(this.assistantService.getErrorMessage(error));
      this.promptControl.setValue(text);
    } finally {
      this.pendingUserMessage.set(null);
      this.sending.set(false);
      this.scrollToConversationEnd();
    }
  }

  async resetConversation(): Promise<void> {
    if (this.loadingConversation() || this.resetting() || this.sending()) {
      return;
    }
    this.resetting.set(true);
    this.errorMessage.set(null);
    try {
      this.conversation.set(await this.assistantService.resetConversation());
      this.promptControl.setValue('');
    } catch (error) {
      this.errorMessage.set(this.assistantService.getErrorMessage(error));
    } finally {
      this.resetting.set(false);
    }
  }

  handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    void this.sendMessage();
  }

  private scrollToConversationEnd(): void {
    setTimeout(() => {
      const element = this.conversationEnd()?.nativeElement;
      if (!element || typeof element.scrollIntoView !== 'function') {
        return;
      }
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    });
  }
}
