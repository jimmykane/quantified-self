import { Component, PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeRevealDirective } from './home-reveal.directive';

@Component({
  standalone: true,
  imports: [HomeRevealDirective],
  template: '<div appHomeReveal>Shared chart content</div>',
})
class RevealHostComponent {}

describe('HomeRevealDirective', () => {
  let fixture: ComponentFixture<RevealHostComponent> | undefined;
  let callback: IntersectionObserverCallback;
  let observer: IntersectionObserver;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const createObserver = vi.fn((listener: IntersectionObserverCallback) => {
    callback = listener;
    observer = { observe, disconnect } as unknown as IntersectionObserver;
    return observer;
  });

  beforeEach(async () => {
    fixture = undefined;
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', createObserver);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    await TestBed.configureTestingModule({ imports: [RevealHostComponent] }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(RevealHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('[appHomeReveal]');
  }

  it('leaves content available before viewport entry and reveals even a small slice of a tall chart row once', async () => {
    const element = await render();
    expect(element.textContent).toBe('Shared chart content');
    expect(element.hidden).toBe(false);
    expect(element.classList.contains('home-reveal-visible')).toBe(false);
    expect(observe).toHaveBeenCalledWith(element);
    callback([{ isIntersecting: false } as IntersectionObserverEntry], observer);
    fixture!.detectChanges();
    expect(element.classList.contains('home-reveal-visible')).toBe(false);
    callback([{ isIntersecting: true, intersectionRatio: 0.001 } as IntersectionObserverEntry], observer);
    fixture!.detectChanges();
    expect(element.classList.contains('home-reveal-visible')).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('keeps content visible without starting an observer when reduced motion is requested', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const element = await render();
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(createObserver).not.toHaveBeenCalled();
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('Shared chart content');
  });

  it('renders content without observer support', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const element = await render();
    expect(createObserver).not.toHaveBeenCalled();
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('Shared chart content');
  });

  it('does not observe or conceal prerendered content', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    const element = await render();
    expect(createObserver).not.toHaveBeenCalled();
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('Shared chart content');
  });

  it('disconnects on teardown and ignores a queued viewport callback after navigation', async () => {
    const element = await render();
    fixture!.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);
    expect(element.classList.contains('home-reveal-visible')).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
