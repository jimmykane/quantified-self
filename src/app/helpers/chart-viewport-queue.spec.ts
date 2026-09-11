import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartViewportQueue } from './chart-viewport-queue';

describe('chart viewport queue', () => {
  let callback: IntersectionObserverCallback;
  let frames: FrameRequestCallback[];
  let observer: { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    frames = [];
    observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('IntersectionObserver', vi.fn(function (handler: IntersectionObserverCallback) {
      callback = handler;
      return observer;
    }));
    vi.stubGlobal('requestAnimationFrame', vi.fn(handler => { frames.push(handler); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());
  const entry = (target: HTMLElement, isIntersecting = true) => ({ target, isIntersecting } as IntersectionObserverEntry);
  const notify = (...entries: IntersectionObserverEntry[]) => callback(entries, observer as unknown as IntersectionObserver);

  it('waits for nearby plots, then starts only one per frame using one observer', async () => {
    const queue = new ChartViewportQueue();
    const firstElement = document.createElement('div');
    const secondElement = document.createElement('div');
    const first = queue.wait(firstElement); const second = queue.wait(secondElement);
    const firstReady = vi.fn(); const secondReady = vi.fn();
    void first.ready.then(firstReady); void second.ready.then(secondReady);
    expect(IntersectionObserver).toHaveBeenCalledTimes(1);
    expect(IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), { root: null, rootMargin: '600px 0px' });
    expect(frames).toHaveLength(0);
    notify(entry(firstElement), entry(secondElement));
    frames.shift()!(0);
    await expect(first.ready).resolves.toBe(true);
    expect(secondReady).not.toHaveBeenCalled();
    frames.shift()!(16);
    await expect(second.ready).resolves.toBe(true);
    expect(firstReady).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('does not initialize charts scrolled past before their frame runs', async () => {
    const queue = new ChartViewportQueue();
    const element = document.createElement('div');
    const wait = queue.wait(element); const ready = vi.fn(); void wait.ready.then(ready);
    notify(entry(element)); notify(entry(element, false));
    frames.shift()!(0); await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    notify(entry(element)); frames.shift()!(16);
    await expect(wait.ready).resolves.toBe(true);
  });

  it('cancels destroyed charts and cleans up the final observer and frame', async () => {
    const queue = new ChartViewportQueue();
    const element = document.createElement('div');
    const wait = queue.wait(element);
    notify(entry(element)); wait.cancel(); wait.cancel();
    await expect(wait.ready).resolves.toBe(false);
    expect(observer.unobserve).toHaveBeenCalledExactlyOnceWith(element);
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    frames.shift()!(0);
    expect(frames).toHaveLength(0);
  });

  it('renders normally when viewport observation is unavailable or fails', async () => {
    const queue = new ChartViewportQueue();
    vi.stubGlobal('IntersectionObserver', undefined);
    await expect(queue.wait(document.createElement('div')).ready).resolves.toBe(true);
    vi.stubGlobal('IntersectionObserver', vi.fn(function () { throw new Error('unsupported'); }));
    await expect(queue.wait(document.createElement('div')).ready).resolves.toBe(true);
  });

  it('uses the nearest scrolling container so the preload margin works inside the app shell and sheets', () => {
    const queue = new ChartViewportQueue();
    const shell = document.createElement('div'); shell.style.overflowY = 'auto';
    const clippedTile = document.createElement('div'); clippedTile.style.overflowY = 'hidden';
    const chart = document.createElement('div'); shell.append(clippedTile); clippedTile.append(chart);
    document.body.append(shell);
    const wait = queue.wait(chart);
    expect(IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), { root: shell, rootMargin: '600px 0px' });
    wait.cancel(); shell.remove();
  });
});
