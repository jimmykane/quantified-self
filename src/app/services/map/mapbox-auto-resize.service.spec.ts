import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapboxAutoResizeService } from './mapbox-auto-resize.service';

describe('MapboxAutoResizeService', () => {
  let service: MapboxAutoResizeService;
  let map: any;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

  beforeEach(() => {
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    (globalThis as any).cancelAnimationFrame = vi.fn();

    map = {
      on: vi.fn(),
      off: vi.fn(),
      resize: vi.fn()
    };

    service = new MapboxAutoResizeService({
      warn: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    } as any);
  });

  afterEach(() => {
    (globalThis as any).requestAnimationFrame = originalRequestAnimationFrame;
    (globalThis as any).cancelAnimationFrame = originalCancelAnimationFrame;
    vi.restoreAllMocks();
  });

  it('binds map and window listeners and resizes on map events', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    service.bind(map, { triggerInitialResize: false });

    expect(map.on).toHaveBeenCalledWith('load', expect.any(Function));
    expect(map.on).toHaveBeenCalledWith('style.load', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('orientationchange', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('pageshow', expect.any(Function));

    const loadHandler = map.on.mock.calls.find((call: any[]) => call[0] === 'load')?.[1];
    loadHandler?.();
    expect(map.resize).toHaveBeenCalled();
  });

  it('calls onResize callback after resize', () => {
    const onResize = vi.fn();
    service.bind(map, { triggerInitialResize: false, onResize });

    const styleLoadHandler = map.on.mock.calls.find((call: any[]) => call[0] === 'style.load')?.[1];
    styleLoadHandler?.();

    expect(map.resize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledTimes(1);
  });

  it('unbinds listeners and disconnects observer', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const disconnect = vi.fn();
    const observe = vi.fn();

    const OriginalResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(_cb: any) { }
      observe = observe;
      disconnect = disconnect;
    };

    const container = document.createElement('div');
    service.bind(map, { container, triggerInitialResize: false });
    expect(observe).toHaveBeenCalledWith(container);

    service.unbind(map);

    expect(map.off).toHaveBeenCalledWith('load', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('style.load', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('orientationchange', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pageshow', expect.any(Function));
    expect(disconnect).toHaveBeenCalledTimes(1);

    (globalThis as any).ResizeObserver = OriginalResizeObserver;
  });

  it('resizes a restored mobile page after it becomes visible again', () => {
    const documentAddListener = vi.spyOn(document, 'addEventListener');
    const windowAddListener = vi.spyOn(window, 'addEventListener');
    service.bind(map, { triggerInitialResize: false, throttleMs: 0 });

    const visibilityHandler = documentAddListener.mock.calls
      .find((call: EventListenerOrEventListenerObject[]) => call[0] === 'visibilitychange')?.[1] as EventListener;
    const pageShowHandler = windowAddListener.mock.calls
      .find((call: EventListenerOrEventListenerObject[]) => call[0] === 'pageshow')?.[1] as EventListener;

    visibilityHandler?.(new Event('visibilitychange'));
    pageShowHandler?.(new Event('pageshow'));

    expect(map.resize).toHaveBeenCalledTimes(2);
  });
});
