import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EChartsHostController } from './echarts-host-controller';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: () => void;
};

describe('EChartsHostController', () => {
  let resizeObserverRecords: ResizeObserverRecord[];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;
  let originalVisualViewport: VisualViewport | undefined;
  let windowEventListeners: Map<string, EventListener>;
  let visualViewportEventListeners: Map<string, EventListener>;

  const chartMock = {
    isDisposed: vi.fn().mockReturnValue(false),
  };

  const buildLoaderMock = () => ({
    init: vi.fn().mockResolvedValue(chartMock),
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  });

  beforeEach(() => {
    resizeObserverRecords = [];
    windowEventListeners = new Map();
    visualViewportEventListeners = new Map();
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    originalVisualViewport = window.visualViewport;

    class ResizeObserverMock {
      public observe = vi.fn();
      public disconnect = vi.fn();

      constructor(private callback: ResizeObserverCallback) {
        resizeObserverRecords.push({
          observe: this.observe,
          disconnect: this.disconnect,
          trigger: () => this.callback([], this as unknown as ResizeObserver),
        });
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        windowEventListeners.set(type, listener);
      }
    }) as typeof window.addEventListener);

    vi.spyOn(window, 'removeEventListener').mockImplementation(((type: string) => {
      windowEventListeners.delete(type);
    }) as typeof window.removeEventListener);

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === 'function') {
            visualViewportEventListeners.set(type, listener);
          }
        }),
        removeEventListener: vi.fn((type: string) => {
          visualViewportEventListeners.delete(type);
        }),
      },
    });
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      delete (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame;
    }

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport,
    });
  });

  it('should initialize once and attach a resize observer', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');

    await controller.init(container);
    await controller.init(container);

    expect(loader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(resizeObserverRecords[0].observe).toHaveBeenCalledWith(container);
    expect(windowEventListeners.has('resize')).toBe(true);
    expect(windowEventListeners.has('orientationchange')).toBe(true);
    expect(visualViewportEventListeners.has('resize')).toBe(true);
  });

  it('should no-op setOption before chart initialization', () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });

    const didSet = controller.setOption({} as any, { notMerge: true });

    expect(didSet).toBe(false);
    expect(loader.setOption).not.toHaveBeenCalled();
  });

  it('should forward setOption and resize calls after initialization', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 180 });

    await controller.init(container);
    const didSet = controller.setOption({ series: [] } as any, { notMerge: true, lazyUpdate: true });
    controller.scheduleResize();

    expect(didSet).toBe(true);
    expect(loader.setOption).toHaveBeenCalledTimes(1);
    expect(loader.resize).toHaveBeenCalledTimes(1);
    expect(loader.resize).toHaveBeenCalledWith(chartMock, {
      silent: true,
    });
  });

  it('should resize from resize observer callback using raf throttling', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 220 });

    await controller.init(container);

    expect(resizeObserverRecords).toHaveLength(1);

    resizeObserverRecords[0].trigger();
    resizeObserverRecords[0].trigger();

    expect(loader.resize).toHaveBeenCalledTimes(1);
  });

  it('should resize from viewport fallback listeners using raf throttling', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 360 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 240 });

    await controller.init(container);

    const resizeListener = windowEventListeners.get('resize');
    const orientationListener = windowEventListeners.get('orientationchange');
    const visualViewportResizeListener = visualViewportEventListeners.get('resize');

    expect(resizeListener).toBeTypeOf('function');
    expect(orientationListener).toBeTypeOf('function');
    expect(visualViewportResizeListener).toBeTypeOf('function');

    resizeListener?.(new Event('resize'));
    orientationListener?.(new Event('orientationchange'));
    visualViewportResizeListener?.(new Event('resize'));

    expect(loader.resize).toHaveBeenCalledTimes(1);
  });

  it('should skip resize when container dimensions are zero', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 0 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 0 });

    await controller.init(container);
    controller.scheduleResize();

    expect(loader.resize).not.toHaveBeenCalled();
  });

  it('should dispose chart and disconnect observers', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');

    await controller.init(container);
    controller.dispose();

    expect(resizeObserverRecords[0].disconnect).toHaveBeenCalledTimes(1);
    expect(loader.dispose).toHaveBeenCalledWith(chartMock);
    expect(windowEventListeners.has('resize')).toBe(false);
    expect(windowEventListeners.has('orientationchange')).toBe(false);
    expect(visualViewportEventListeners.has('resize')).toBe(false);
  });

  it('should log initialization failures and return null', async () => {
    const logger = { error: vi.fn() };
    const loader = buildLoaderMock();
    loader.init.mockRejectedValue(new Error('boom'));
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      logger,
      logPrefix: '[TestChart]'
    });
    const container = document.createElement('div');

    const chart = await controller.init(container);

    expect(chart).toBeNull();
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toBe('[TestChart] Failed to initialize ECharts');
  });
});
