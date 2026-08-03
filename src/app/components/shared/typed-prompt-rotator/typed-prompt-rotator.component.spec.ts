import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { By } from '@angular/platform-browser';
import { TypedPromptRotatorComponent } from './typed-prompt-rotator.component';

describe('TypedPromptRotatorComponent', () => {
  let fixture: ComponentFixture<TypedPromptRotatorComponent>;
  let component: TypedPromptRotatorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TypedPromptRotatorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TypedPromptRotatorComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the typing prompt and caret', () => {
    fixture.componentRef.setInput('prompts', ['Show my weekly running distance.']);
    fixture.detectChanges();

    const promptText = fixture.debugElement.query(By.css('.hero-prompt-text'))?.nativeElement as HTMLElement | undefined;
    const promptCaret = fixture.debugElement.query(By.css('.hero-prompt-caret'))?.nativeElement as HTMLElement | undefined;

    expect(promptText?.textContent?.trim()).toBe('S');
    expect(promptCaret).toBeTruthy();
  });

  it('emits the active prompt when interactive rotator is clicked', () => {
    const selectedPrompts: string[] = [];
    component.promptSelect.subscribe((prompt) => {
      selectedPrompts.push(prompt);
    });

    fixture.componentRef.setInput('prompts', ['Compare pace and heart rate over 90 days.']);
    fixture.componentRef.setInput('interactive', true);
    fixture.detectChanges();

    const trigger = fixture.debugElement.query(By.css('.hero-prompt-rotator'))?.nativeElement as HTMLButtonElement | undefined;
    trigger?.click();

    expect(selectedPrompts).toEqual(['Compare pace and heart rate over 90 days.']);
  });

  it('pauses typing while offscreen or when the document is hidden', () => {
    vi.useFakeTimers();
    let observerCallback: IntersectionObserverCallback | undefined;
    vi.stubGlobal('IntersectionObserver', vi.fn((callback: IntersectionObserverCallback) => {
      observerCallback = callback;
      return { observe: vi.fn(), disconnect: vi.fn() };
    }));

    fixture.destroy();
    fixture = TestBed.createComponent(TypedPromptRotatorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('prompts', ['Show my weekly running distance.']);
    fixture.detectChanges();

    observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    fixture.detectChanges();
    vi.advanceTimersByTime(3 * 38);
    expect(component.typedPrompt()).toBe('Show');

    observerCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    fixture.detectChanges();
    const offscreenPrompt = component.typedPrompt();
    vi.advanceTimersByTime(200);
    expect(component.typedPrompt()).toBe(offscreenPrompt);

    observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    fixture.detectChanges();
    vi.advanceTimersByTime(37);
    expect(component.typedPrompt()).toBe(offscreenPrompt);
    vi.advanceTimersByTime(1);
    expect(component.typedPrompt()).toBe('Show ');

    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    fixture.detectChanges();
    const hiddenPrompt = component.typedPrompt();
    vi.advanceTimersByTime(200);
    expect(component.typedPrompt()).toBe(hiddenPrompt);

    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    } else {
      delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  });

  it('does not start viewport observation or typing timers during SSR', async () => {
    vi.useFakeTimers();
    const intersectionObserver = vi.fn();
    vi.stubGlobal('IntersectionObserver', intersectionObserver);

    fixture.destroy();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TypedPromptRotatorComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    }).compileComponents();

    fixture = TestBed.createComponent(TypedPromptRotatorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('prompts', ['Show my weekly running distance.']);
    fixture.detectChanges();
    vi.advanceTimersByTime(500);

    expect(intersectionObserver).not.toHaveBeenCalled();
    expect(component.typedPrompt()).toBe('S');
  });
});
