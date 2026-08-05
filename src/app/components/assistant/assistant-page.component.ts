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
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ASSISTANT_MAX_MESSAGE_CHARS,
  type AssistantConversation,
  type AssistantMessage,
} from '@shared/assistant.types';
import type { AssistantQuotaStatus } from '@shared/assistant.types';
import {
  ASSISTANT_COMPOSER_EXAMPLE_PROMPT,
  ASSISTANT_STARTER_PROMPTS,
} from '@shared/assistant.prompts';
import { MaterialModule } from '../../modules/material.module';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import {
  AssistantError,
  AssistantService,
} from '../../services/assistant.service';

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
  private readonly quotaService = inject(AssistantQuotaService);
  private readonly conversationEnd = viewChild<ElementRef<HTMLElement>>('conversationEnd');
  private readonly retryRequest = signal<{ message: string; requestId: string } | null>(null);

  readonly maxMessageChars = ASSISTANT_MAX_MESSAGE_CHARS;
  readonly starterPrompts = ASSISTANT_STARTER_PROMPTS;
  readonly composerPlaceholder = `For example: ${ASSISTANT_COMPOSER_EXAMPLE_PROMPT}`;
  readonly promptControl = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.pattern(/\S/),
      Validators.maxLength(ASSISTANT_MAX_MESSAGE_CHARS),
    ],
  });
  private readonly promptValue = toSignal(this.promptControl.valueChanges, {
    initialValue: this.promptControl.value,
  });
  readonly conversation = signal<AssistantConversation | null>(null);
  readonly pendingUserMessage = signal<AssistantMessage | null>(null);
  readonly quota = signal<AssistantQuotaStatus | null>(null);
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
  readonly quotaPreventsSend = computed(() => {
    const retryRequest = this.retryRequest();
    return this.quotaBlocked()
      && retryRequest?.message !== this.promptValue().trim();
  });
  readonly quotaText = computed(() => {
    const status = this.quota();
    if (!status) {
      return this.loadingConversation()
        ? 'Assistant allowance is loading'
        : 'Allowance status unavailable; it will be checked when you send';
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
      || this.quotaPreventsSend()
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
    const retryRequest = this.retryRequest();
    const request = retryRequest?.message === text
      ? retryRequest
      : {
        message: text,
        requestId: globalThis.crypto.randomUUID(),
      };
    this.retryRequest.set(request);
    this.pendingUserMessage.set({
      id: request.requestId,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    });
    this.promptControl.setValue('');
    this.scrollToConversationEnd();
    const activeConversation = this.conversation();
    try {
      const response = await this.assistantService.sendMessage({
        requestId: request.requestId,
        message: text,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        ...(activeConversation?.conversationId
          ? { conversationId: activeConversation.conversationId }
          : {}),
      });
      this.conversation.set(response.conversation);
      this.quota.set(response.quota);
      this.retryRequest.set(null);
    } catch (error) {
      let refreshedConversation: AssistantConversation | null | undefined;
      try {
        refreshedConversation = await this.assistantService.getConversation();
      } catch {
        // Preserve the original send failure when reconciliation is unavailable.
      }
      if (refreshedConversation && this.isCompletedTurnRecovery(
        activeConversation,
        refreshedConversation,
        request.requestId,
        text,
      )) {
        this.conversation.set(refreshedConversation);
        this.errorMessage.set(null);
        this.retryRequest.set(null);
      } else {
        if (activeConversation !== null
          && refreshedConversation !== undefined
          && refreshedConversation?.conversationId
            !== activeConversation.conversationId) {
          this.retryRequest.set(null);
        }
        if (refreshedConversation !== undefined) {
          this.conversation.set(refreshedConversation);
        }
        this.errorMessage.set(this.assistantService.getErrorMessage(error));
        this.promptControl.setValue(text);
        if (error instanceof AssistantError
          && error.code === 'CONVERSATION_CHANGED'
          && refreshedConversation !== undefined) {
          this.errorMessage.set(
            'The conversation changed in another tab. It has been refreshed; try again.',
          );
        }
      }
      try {
        this.quota.set(await this.quotaService.loadQuotaStatus());
      } catch {
        // Do not present a potentially stale allowance after a failed attempt.
        this.quota.set(null);
      }
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
      this.retryRequest.set(null);
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

  private isCompletedTurnRecovery(
    previousConversation: AssistantConversation | null,
    refreshedConversation: AssistantConversation,
    requestId: string,
    sentText: string,
  ): boolean {
    if (previousConversation
      && refreshedConversation.conversationId !== previousConversation.conversationId) {
      return false;
    }
    const previousMessages = previousConversation?.messages ?? [];
    const previousMessageIds = new Set(previousMessages.map(message => message.id));
    const userMessageIndex = refreshedConversation.messages.findIndex(
      message => message.id === requestId,
    );
    const userMessage = refreshedConversation.messages[userMessageIndex];
    const assistantMessage = refreshedConversation.messages[userMessageIndex + 1];
    return userMessageIndex >= 0
      && userMessage?.role === 'user'
      && userMessage.id === requestId
      && userMessage.text === sentText
      && !previousMessageIds.has(userMessage.id)
      && assistantMessage?.role === 'assistant'
      && !previousMessageIds.has(assistantMessage.id);
  }
}
