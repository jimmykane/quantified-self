import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

const PROMPT_TYPING_DELAY_MS = 38;
const PROMPT_DELETING_DELAY_MS = 20;
const PROMPT_HOLD_DELAY_MS = 1900;
const PROMPT_BETWEEN_PROMPTS_DELAY_MS = 280;

@Component({
  selector: 'app-typed-prompt-rotator',
  templateUrl: './typed-prompt-rotator.component.html',
  styleUrls: ['./typed-prompt-rotator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TypedPromptRotatorComponent {
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly promptViewport = viewChild<ElementRef<HTMLElement>>('promptViewport');
  private readonly promptTrack = viewChild<ElementRef<HTMLElement>>('promptTrack');
  private trackSyncFrame: number | null = null;

  readonly prompts = input<readonly string[]>([]);
  readonly disabled = input(false);
  readonly interactive = input(false);
  readonly ariaLabelPrefix = input('Example prompt: ');
  readonly promptSelect = output<string>();

  readonly activePrompt = signal('');
  readonly typedPrompt = signal('');
  readonly promptTrackOffsetPx = signal(0);
  readonly promptTrackTransform = computed(() => (
    `translateX(-${this.promptTrackOffsetPx()}px)`
  ));
  readonly normalizedPrompts = computed(() => (
    this.prompts()
      .map((prompt) => prompt.trim())
      .filter((prompt) => prompt.length > 0)
  ));
  readonly promptAriaLabel = computed(() => (
    `${this.ariaLabelPrefix()}${this.activePrompt()}`
  ));

  private readonly promptAnimation = effect((onCleanup) => {
    const prompts = this.normalizedPrompts();
    if (!prompts.length) {
      this.activePrompt.set('');
      this.typedPrompt.set('');
      return;
    }

    let promptIndex = 0;
    let charIndex = Math.min(1, prompts[0].length);
    let deleting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const applyPromptFrame = (nextPromptIndex: number, nextCharIndex: number): void => {
      const prompt = prompts[nextPromptIndex] ?? '';
      promptIndex = nextPromptIndex;
      charIndex = nextCharIndex;
      this.activePrompt.set(prompt);
      this.typedPrompt.set(prompt.slice(0, nextCharIndex));
    };

    const schedule = (delay: number): void => {
      this.ngZone.runOutsideAngular(() => {
        timer = setTimeout(tick, delay);
      });
    };

    const tick = (): void => {
      const prompt = prompts[promptIndex] ?? '';
      if (!prompt) {
        return;
      }

      if (!deleting) {
        if (charIndex < prompt.length) {
          applyPromptFrame(promptIndex, charIndex + 1);
          schedule(PROMPT_TYPING_DELAY_MS);
          return;
        }

        deleting = true;
        schedule(PROMPT_HOLD_DELAY_MS);
        return;
      }

      if (charIndex > 1) {
        applyPromptFrame(promptIndex, charIndex - 1);
        schedule(PROMPT_DELETING_DELAY_MS);
        return;
      }

      deleting = false;
      const nextPromptIndex = (promptIndex + 1) % prompts.length;
      applyPromptFrame(nextPromptIndex, Math.min(1, prompts[nextPromptIndex]?.length ?? 0));
      schedule(PROMPT_BETWEEN_PROMPTS_DELAY_MS);
    };

    applyPromptFrame(0, charIndex);
    schedule(PROMPT_TYPING_DELAY_MS);

    onCleanup(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    });
  });
  private readonly promptTrackSyncEffect = effect(() => {
    this.typedPrompt();
    this.promptViewport();
    this.promptTrack();
    this.schedulePromptTrackSync();
  });

  constructor() {
    const windowRef = globalThis.window;
    if (!windowRef) {
      return;
    }

    const onResize = (): void => {
      this.schedulePromptTrackSync();
    };

    this.ngZone.runOutsideAngular(() => {
      windowRef.addEventListener('resize', onResize, { passive: true });
    });
    this.destroyRef.onDestroy(() => {
      windowRef.removeEventListener('resize', onResize);
      this.cancelPromptTrackSync();
    });
  }

  onPromptClick(): void {
    if (!this.interactive() || this.disabled()) {
      return;
    }

    const prompt = this.activePrompt().trim();
    if (!prompt) {
      return;
    }

    this.promptSelect.emit(prompt);
  }

  private schedulePromptTrackSync(): void {
    const windowRef = globalThis.window;
    if (!windowRef || typeof windowRef.requestAnimationFrame !== 'function') {
      this.syncPromptTrackOffset();
      return;
    }

    this.cancelPromptTrackSync();
    this.ngZone.runOutsideAngular(() => {
      this.trackSyncFrame = windowRef.requestAnimationFrame(() => {
        this.trackSyncFrame = null;
        this.syncPromptTrackOffset();
      });
    });
  }

  private cancelPromptTrackSync(): void {
    const windowRef = globalThis.window;
    if (this.trackSyncFrame === null || !windowRef || typeof windowRef.cancelAnimationFrame !== 'function') {
      this.trackSyncFrame = null;
      return;
    }

    windowRef.cancelAnimationFrame(this.trackSyncFrame);
    this.trackSyncFrame = null;
  }

  private syncPromptTrackOffset(): void {
    const viewportElement = this.promptViewport()?.nativeElement;
    const trackElement = this.promptTrack()?.nativeElement;
    if (!viewportElement || !trackElement) {
      this.promptTrackOffsetPx.set(0);
      return;
    }

    const viewportWidth = viewportElement.clientWidth;
    const trackWidth = trackElement.scrollWidth;
    const nextOffset = Math.max(0, trackWidth - viewportWidth);
    if (this.promptTrackOffsetPx() !== nextOffset) {
      this.promptTrackOffsetPx.set(nextOffset);
    }
  }
}
