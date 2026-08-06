import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ASSISTANT_MAX_MESSAGE_CHARS,
  isValidAssistantRequestId,
  type AssistantConversation,
  type AssistantMessage,
} from '@shared/assistant.types';
import type { AssistantQuotaStatus } from '@shared/assistant.types';
import { MaterialModule } from '../../modules/material.module';
import { AssistantQuotaService } from '../../services/assistant-quota.service';
import {
  AssistantError,
  AssistantService,
} from '../../services/assistant.service';
import { AssistantExploreBottomSheetComponent } from './assistant-explore-bottom-sheet.component';

const ASSISTANT_PENDING_INITIAL_POLL_INTERVAL_MS = 2_000;
const ASSISTANT_PENDING_MAX_POLL_INTERVAL_MS = 5_000;
const ASSISTANT_PENDING_POLL_BACKOFF_FACTOR = 1.5;
const ASSISTANT_PENDING_RECOVERY_TIMEOUT_MS = (4 * 60 * 1_000) + 30_000;
const ASSISTANT_PENDING_REGISTRATION_GRACE_MS = 15_000;
const ASSISTANT_PENDING_REQUEST_STORAGE_KEY = 'quantified-self.assistant.pending-request-id';

@Component({
  selector: 'app-assistant-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MaterialModule,
    TextFieldModule,
  ],
  templateUrl: './assistant-page.component.html',
  styleUrls: ['./assistant-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPageComponent implements OnInit, OnDestroy {
  private readonly assistantService = inject(AssistantService);
  private readonly quotaService = inject(AssistantQuotaService);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly assistantPage = viewChild<ElementRef<HTMLElement>>('assistantPage');
  private readonly conversationEnd = viewChild<ElementRef<HTMLElement>>('conversationEnd');
  private readonly retryRequest = signal<{ message: string; requestId: string } | null>(null);
  private readonly pendingRequestId = signal<string | null>(null);
  private pendingPollTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPollIntervalMs = ASSISTANT_PENDING_INITIAL_POLL_INTERVAL_MS;
  private pendingRecoveryDeadlineMs = 0;
  private pendingRegistrationDeadlineMs = 0;
  private destroyed = false;

  readonly maxMessageChars = ASSISTANT_MAX_MESSAGE_CHARS;
  readonly composerPlaceholder = 'Ask about your data…';
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
        ? 'Loading allowance'
        : 'Allowance checked when you send';
    }
    return `${status.remainingCount} of ${status.limit} remaining`;
  });

  async ngOnInit(): Promise<void> {
    const rememberedRequestId = this.readRememberedPendingRequestId();
    const [conversationResult, quotaResult] = await Promise.allSettled([
      this.assistantService.getConversationState(),
      this.quotaService.loadQuotaStatus(),
    ]);
    if (conversationResult.status === 'fulfilled') {
      this.conversation.set(conversationResult.value.conversation);
      if (conversationResult.value.pendingRequestId) {
        this.startPendingResponseRecovery(conversationResult.value.pendingRequestId);
      } else if (rememberedRequestId
        && !this.hasCompletedRequest(conversationResult.value.conversation, rememberedRequestId)) {
        this.startPendingResponseRecovery(rememberedRequestId, true);
      } else {
        this.clearRememberedPendingRequestId();
      }
    } else if (rememberedRequestId
      && this.isRetryablePendingStateError(conversationResult.reason)) {
      this.startPendingResponseRecovery(rememberedRequestId, true);
    } else {
      this.clearRememberedPendingRequestId(rememberedRequestId ?? undefined);
      this.errorMessage.set(this.assistantService.getErrorMessage(conversationResult.reason));
    }
    if (quotaResult.status === 'fulfilled') {
      this.quota.set(quotaResult.value);
    }
    this.loadingConversation.set(false);
    if (!this.isEmpty()) {
      this.scrollToConversationEnd();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cancelPendingResponsePoll();
  }

  useStarterPrompt(prompt: string): void {
    this.promptControl.setValue(prompt);
    this.promptControl.markAsDirty();
  }

  openExploreSheet(): void {
    this.bottomSheet.open(AssistantExploreBottomSheetComponent)
      .afterDismissed()
      .subscribe((prompt: string | undefined) => {
        if (typeof prompt === 'string') {
          this.useStarterPrompt(prompt);
        }
      });
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
    const activeConversation = this.conversation();
    const hadConversationMessages = this.messages().length > 0;
    const retryRequest = this.retryRequest();
    const request = retryRequest?.message === text
      ? retryRequest
      : {
        message: text,
        requestId: globalThis.crypto.randomUUID(),
      };
    this.retryRequest.set(request);
    this.pendingRequestId.set(request.requestId);
    this.rememberPendingRequestId(request.requestId);
    this.pendingUserMessage.set({
      id: request.requestId,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    });
    this.promptControl.setValue('');
    if (hadConversationMessages) {
      this.scrollToConversationEnd();
    }
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
      this.pendingRequestId.set(null);
      this.clearRememberedPendingRequestId(request.requestId);
    } catch (error) {
      let refreshedConversation: AssistantConversation | null | undefined;
      let refreshedPendingRequestId: string | null | undefined;
      try {
        const refreshedState = await this.assistantService.getConversationState();
        refreshedConversation = refreshedState.conversation;
        refreshedPendingRequestId = refreshedState.pendingRequestId;
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
        this.pendingRequestId.set(null);
        this.clearRememberedPendingRequestId(request.requestId);
      } else if (refreshedPendingRequestId === request.requestId) {
        if (refreshedConversation !== undefined) {
          this.conversation.set(refreshedConversation);
        }
        this.errorMessage.set(null);
        this.startPendingResponseRecovery(request.requestId);
      } else {
        this.pendingRequestId.set(null);
        if (refreshedConversation !== undefined) {
          this.clearRememberedPendingRequestId(request.requestId);
        }
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
      if (this.pendingRequestId() !== request.requestId) {
        this.pendingUserMessage.set(null);
        this.sending.set(false);
        if (this.isEmpty()) {
          this.scrollToPageStart();
        } else {
          this.scrollToConversationEnd();
        }
      }
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
      this.cancelPendingResponsePoll();
      this.pendingRequestId.set(null);
      this.clearRememberedPendingRequestId();
      this.retryRequest.set(null);
      this.promptControl.setValue('');
      this.scrollToPageStart();
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

  handleComposerSubmit(event: SubmitEvent): void {
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

  private scrollToPageStart(): void {
    setTimeout(() => {
      const element = this.assistantPage()?.nativeElement;
      if (!element || typeof element.scrollIntoView !== 'function') {
        return;
      }
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  private startPendingResponseRecovery(
    requestId: string,
    awaitingServerRegistration = false,
  ): void {
    this.cancelPendingResponsePoll();
    this.rememberPendingRequestId(requestId);
    this.pendingRequestId.set(requestId);
    this.pendingPollIntervalMs = ASSISTANT_PENDING_INITIAL_POLL_INTERVAL_MS;
    this.pendingRecoveryDeadlineMs = Date.now() + ASSISTANT_PENDING_RECOVERY_TIMEOUT_MS;
    this.pendingRegistrationDeadlineMs = awaitingServerRegistration
      ? Date.now() + ASSISTANT_PENDING_REGISTRATION_GRACE_MS
      : 0;
    this.sending.set(true);
    this.schedulePendingResponsePoll(requestId);
  }

  private async pollPendingResponse(requestId: string): Promise<void> {
    if (this.destroyed || this.pendingRequestId() !== requestId) {
      return;
    }
    try {
      const state = await this.assistantService.getConversationState();
      if (this.destroyed || this.pendingRequestId() !== requestId) {
        return;
      }
      this.conversation.set(state.conversation);
      if (this.hasCompletedRequest(state.conversation, requestId)) {
        this.retryRequest.set(null);
        this.errorMessage.set(null);
        await this.finishPendingResponseRecovery(requestId);
        return;
      }
      if (state.pendingRequestId === requestId) {
        this.pendingRegistrationDeadlineMs = 0;
      } else if (state.pendingRequestId !== null
        || Date.now() >= this.pendingRegistrationDeadlineMs) {
        this.errorMessage.set(
          'The previous Assistant request did not finish. Please try again.',
        );
        await this.finishPendingResponseRecovery(requestId);
        return;
      }
    } catch (error) {
      if (!this.isRetryablePendingStateError(error)) {
        this.errorMessage.set(this.assistantService.getErrorMessage(error));
        await this.finishPendingResponseRecovery(requestId);
        return;
      }
      // A transient status-read failure is retried within the bounded turn lease.
    }
    if (this.destroyed || this.pendingRequestId() !== requestId) {
      return;
    }
    if (Date.now() >= this.pendingRecoveryDeadlineMs) {
      this.errorMessage.set(
        'The Assistant response is taking too long. Please try again.',
      );
      await this.finishPendingResponseRecovery(requestId);
      return;
    }
    this.schedulePendingResponsePoll(requestId);
  }

  private async finishPendingResponseRecovery(requestId: string): Promise<void> {
    if (this.pendingRequestId() !== requestId) {
      return;
    }
    const pendingText = this.pendingUserMessage()?.text;
    this.cancelPendingResponsePoll();
    this.pendingRequestId.set(null);
    this.clearRememberedPendingRequestId(requestId);
    this.pendingUserMessage.set(null);
    this.sending.set(false);
    if (this.errorMessage() && pendingText) {
      this.promptControl.setValue(pendingText);
    }
    try {
      this.quota.set(await this.quotaService.loadQuotaStatus());
    } catch {
      this.quota.set(null);
    }
    if (this.isEmpty()) {
      this.scrollToPageStart();
    } else {
      this.scrollToConversationEnd();
    }
  }

  private cancelPendingResponsePoll(): void {
    if (this.pendingPollTimer !== null) {
      clearTimeout(this.pendingPollTimer);
      this.pendingPollTimer = null;
    }
  }

  private schedulePendingResponsePoll(requestId: string): void {
    const delayMs = this.pendingPollIntervalMs;
    this.pendingPollIntervalMs = Math.min(
      Math.round(delayMs * ASSISTANT_PENDING_POLL_BACKOFF_FACTOR),
      ASSISTANT_PENDING_MAX_POLL_INTERVAL_MS,
    );
    this.pendingPollTimer = setTimeout(() => {
      void this.pollPendingResponse(requestId);
    }, delayMs);
  }

  private isRetryablePendingStateError(error: unknown): boolean {
    return !(error instanceof AssistantError) || error.code === 'UNAVAILABLE';
  }

  private rememberPendingRequestId(requestId: string): void {
    try {
      globalThis.sessionStorage?.setItem(
        ASSISTANT_PENDING_REQUEST_STORAGE_KEY,
        requestId,
      );
    } catch {
      // Server state still provides recovery when browser storage is unavailable.
    }
  }

  private readRememberedPendingRequestId(): string | null {
    try {
      const requestId = globalThis.sessionStorage?.getItem(
        ASSISTANT_PENDING_REQUEST_STORAGE_KEY,
      );
      if (isValidAssistantRequestId(requestId)) {
        return requestId;
      }
      this.clearRememberedPendingRequestId();
    } catch {
      // Treat unavailable browser storage as no locally pending request.
    }
    return null;
  }

  private clearRememberedPendingRequestId(expectedRequestId?: string): void {
    try {
      if (expectedRequestId) {
        const rememberedRequestId = globalThis.sessionStorage?.getItem(
          ASSISTANT_PENDING_REQUEST_STORAGE_KEY,
        );
        if (rememberedRequestId !== expectedRequestId) {
          return;
        }
      }
      globalThis.sessionStorage?.removeItem(ASSISTANT_PENDING_REQUEST_STORAGE_KEY);
    } catch {
      // Browser privacy settings can make tab-scoped storage unavailable.
    }
  }

  private hasCompletedRequest(
    conversation: AssistantConversation | null,
    requestId: string,
  ): boolean {
    if (!conversation) {
      return false;
    }
    const userMessageIndex = conversation.messages.findIndex(
      message => message.role === 'user' && message.id === requestId,
    );
    return userMessageIndex >= 0
      && conversation.messages[userMessageIndex + 1]?.role === 'assistant';
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
