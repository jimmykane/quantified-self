import { DOCUMENT, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, PLATFORM_ID, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';

const PROMPT_TYPING_DELAY_MS = 38;
const PROMPT_DELETING_DELAY_MS = 20;
const PROMPT_HOLD_DELAY_MS = 1900;
const PROMPT_BETWEEN_PROMPTS_DELAY_MS = 280;

@Component({
  selector: 'app-typed-prompt-rotator',
  templateUrl: './typed-prompt-rotator.component.html',
  styleUrls: ['./typed-prompt-rotator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [NgTemplateOutlet],
})
export class TypedPromptRotatorComponent implements AfterViewInit {
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentRef = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly promptViewport = viewChild<ElementRef<HTMLElement>>('promptViewport');
  private readonly promptTrack = viewChild<ElementRef<HTMLElement>>('promptTrack');
  private trackSyncFrame: number | null = null;
  private readonly isInViewport = signal(false);
  private readonly isDocumentVisible = signal(this.documentRef.visibilityState !== 'hidden');
  private animationPrompts: readonly string[] | null = null;
  private animationPromptIndex = 0;
  private animationCharIndex = 0;
  private animationDeleting = false;
  private animationDelayRemainingMs = PROMPT_TYPING_DELAY_MS;
  private animationDelayStartedAtMs: number | null = null;

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
  private readonly shouldAnimate = computed(() => (
    this.isInViewport() && this.isDocumentVisible()
  ));

  private readonly promptAnimation = effect((onCleanup) => {
    const prompts = this.normalizedPrompts();
    if (!prompts.length) {
      this.animationPrompts = prompts;
      this.animationPromptIndex = 0;
      this.animationCharIndex = 0;
      this.animationDeleting = false;
      this.animationDelayRemainingMs = PROMPT_TYPING_DELAY_MS;
      this.animationDelayStartedAtMs = null;
      this.activePrompt.set('');
      this.typedPrompt.set('');
      return;
    }

    if (this.animationPrompts !== prompts) {
      this.animationPrompts = prompts;
      this.animationPromptIndex = 0;
      this.animationCharIndex = Math.min(1, prompts[0].length);
      this.animationDeleting = false;
      this.animationDelayRemainingMs = PROMPT_TYPING_DELAY_MS;
      this.animationDelayStartedAtMs = null;
      this.activePrompt.set(prompts[0]);
      this.typedPrompt.set(prompts[0].slice(0, this.animationCharIndex));
    }

    if (!this.shouldAnimate()) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const applyPromptFrame = (nextPromptIndex: number, nextCharIndex: number): void => {
      const prompt = prompts[nextPromptIndex] ?? '';
      this.animationPromptIndex = nextPromptIndex;
      this.animationCharIndex = nextCharIndex;
      this.activePrompt.set(prompt);
      this.typedPrompt.set(prompt.slice(0, nextCharIndex));
    };

    const schedule = (delay: number): void => {
      this.animationDelayRemainingMs = Math.max(0, delay);
      this.animationDelayStartedAtMs = Date.now();
      this.ngZone.runOutsideAngular(() => {
        timer = setTimeout(() => {
          timer = null;
          this.animationDelayStartedAtMs = null;
          this.animationDelayRemainingMs = 0;
          tick();
        }, this.animationDelayRemainingMs);
      });
    };

    const tick = (): void => {
      const prompt = prompts[this.animationPromptIndex] ?? '';
      if (!prompt) {
        return;
      }

      if (!this.animationDeleting) {
        if (this.animationCharIndex < prompt.length) {
          applyPromptFrame(this.animationPromptIndex, this.animationCharIndex + 1);
          schedule(PROMPT_TYPING_DELAY_MS);
          return;
        }

        this.animationDeleting = true;
        schedule(PROMPT_HOLD_DELAY_MS);
        return;
      }

      if (this.animationCharIndex > 1) {
        applyPromptFrame(this.animationPromptIndex, this.animationCharIndex - 1);
        schedule(PROMPT_DELETING_DELAY_MS);
        return;
      }

      this.animationDeleting = false;
      const nextPromptIndex = (this.animationPromptIndex + 1) % prompts.length;
      applyPromptFrame(nextPromptIndex, Math.min(1, prompts[nextPromptIndex]?.length ?? 0));
      schedule(PROMPT_BETWEEN_PROMPTS_DELAY_MS);
    };

    schedule(this.animationDelayRemainingMs);

    onCleanup(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (this.animationDelayStartedAtMs !== null) {
        const elapsedMs = Date.now() - this.animationDelayStartedAtMs;
        this.animationDelayRemainingMs = Math.max(0, this.animationDelayRemainingMs - elapsedMs);
        this.animationDelayStartedAtMs = null;
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

  ngAfterViewInit(): void {
    if (!this.isBrowser) {
      return;
    }

    const onVisibilityChange = (): void => {
      this.isDocumentVisible.set(this.documentRef.visibilityState !== 'hidden');
    };

    onVisibilityChange();
    this.documentRef.addEventListener('visibilitychange', onVisibilityChange);
    this.destroyRef.onDestroy(() => {
      this.documentRef.removeEventListener('visibilitychange', onVisibilityChange);
    });

    if (typeof IntersectionObserver === 'undefined') {
      this.isInViewport.set(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      this.isInViewport.set(entry?.isIntersecting ?? false);
    }, { threshold: 0 });
    observer.observe(this.hostElement.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
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
