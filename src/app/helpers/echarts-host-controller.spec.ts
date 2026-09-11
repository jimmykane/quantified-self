import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EChartsHostController } from './echarts-host-controller';
import { chartViewportQueue } from './chart-viewport-queue';
import { buildDashboardEChartsStyleTokens, buildDashboardEChartsTooltipChrome } from './dashboard-echarts-style.helper';

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
    dispatchAction: vi.fn(),
  };

  const buildLoaderMock = () => ({
    init: vi.fn().mockResolvedValue(chartMock),
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    subscribeToViewportResize: vi.fn(() => () => { }),
    attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
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
    expect(loader.subscribeToViewportResize).toHaveBeenCalledTimes(1);
    expect(loader.attachMobileSeriesTapFeedback).toHaveBeenCalledTimes(1);
    expect(windowEventListeners.size).toBe(0);
    expect(visualViewportEventListeners.size).toBe(0);
  });

  it('should initialize the replacement host when the first host is removed during lazy initialization', async () => {
    const loader = buildLoaderMock();
    const firstChart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispatchAction: vi.fn(),
    };
    const replacementChart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispatchAction: vi.fn(),
    };
    let resolveFirstInitialization: ((chart: typeof firstChart) => void) | null = null;
    loader.init
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirstInitialization = resolve;
      }))
      .mockResolvedValueOnce(replacementChart);
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const firstContainer = document.createElement('div');
    const replacementContainer = document.createElement('div');

    const firstInitialization = controller.init(firstContainer);
    controller.dispose();
    const replacementInitialization = controller.init(replacementContainer);
    resolveFirstInitialization?.(firstChart);

    await expect(firstInitialization).resolves.toBeNull();
    await expect(replacementInitialization).resolves.toBe(replacementChart);
    expect(loader.init).toHaveBeenCalledTimes(2);
    expect(loader.init).toHaveBeenNthCalledWith(1, firstContainer, undefined, undefined);
    expect(loader.init).toHaveBeenNthCalledWith(2, replacementContainer, undefined, undefined);
    expect(loader.dispose).toHaveBeenCalledWith(firstChart);
    expect(resizeObserverRecords.at(-1)?.observe).toHaveBeenCalledWith(replacementContainer);
  });

  it('should allow disabling mobile tap feedback attachment', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      enableMobileTapFeedback: false,
    });
    const container = document.createElement('div');

    await controller.init(container);

    expect(loader.attachMobileSeriesTapFeedback).not.toHaveBeenCalled();
  });

  it('should forward mobile tap feedback options to the loader', async () => {
    const loader = buildLoaderMock();
    const mobileTapFeedbackOptions = { axisPointerFeedback: 'afterFirstInteraction' as const };
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      mobileTapFeedbackOptions,
    });
    const container = document.createElement('div');

    await controller.init(container);

    expect(loader.attachMobileSeriesTapFeedback).toHaveBeenCalledWith(chartMock, mobileTapFeedbackOptions);
  });

  it('should resolve mobile tap feedback options lazily when attaching feedback', async () => {
    const loader = buildLoaderMock();
    const mobileTapFeedbackOptions = { axisPointerFeedback: 'afterFirstInteraction' as const };
    const resolveMobileTapFeedbackOptions = vi.fn(() => mobileTapFeedbackOptions);
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      mobileTapFeedbackOptions: resolveMobileTapFeedbackOptions,
    });
    const container = document.createElement('div');

    await controller.init(container);

    expect(resolveMobileTapFeedbackOptions).toHaveBeenCalledTimes(1);
    expect(loader.attachMobileSeriesTapFeedback).toHaveBeenCalledWith(chartMock, mobileTapFeedbackOptions);
  });

  it('should reinitialize the chart when the requested theme changes', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');

    await controller.init(container, 'light');
    await controller.init(container, 'dark');

    expect(loader.init).toHaveBeenCalledTimes(2);
    expect(loader.dispose).toHaveBeenCalledWith(chartMock);
  });

  it('should forward init options to the loader during initialization', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      initOptions: {
        useDirtyRect: true,
      },
    });
    const container = document.createElement('div');

    await controller.init(container);

    expect(loader.init).toHaveBeenCalledWith(container, undefined, {
      useDirtyRect: true,
    });
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
      width: 'auto',
      height: 'auto',
      silent: true,
    });
  });

  it('releases fixed initialization dimensions when a preview grows to its live container', async () => {
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = vi.fn(callback => { frames.push(callback); return frames.length; });
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      initOptions: { width: 96, height: 38 },
    });
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 540 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 100 });
    await controller.init(container);
    controller.scheduleResize();
    frames.shift()!(0);
    expect(loader.resize).toHaveBeenLastCalledWith(chartMock, { width: 'auto', height: 'auto', silent: true });
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 280 });
    resizeObserverRecords[0].trigger();
    frames.shift()!(0);
    expect(loader.resize).toHaveBeenCalledTimes(2);
    expect(loader.resize).toHaveBeenLastCalledWith(chartMock, { width: 'auto', height: 'auto', silent: true });
  });

  it('ignores repeated viewport-height events when the chart size is unchanged', async () => {
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = vi.fn(callback => { frames.push(callback); return frames.length; });
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({ eChartsLoader: loader as any });
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 360 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 240 });
    await controller.init(container);
    for (let frame = 0; frame < 30; frame++) {
      controller.scheduleResize(); frames.shift()!(frame * 16);
    }
    expect(loader.resize).toHaveBeenCalledTimes(1);
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 600 });
    controller.scheduleResize(); frames.shift()!(500);
    expect(loader.resize).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('waits for the viewport and only lets the newest pending refresh apply its data', async () => {
    let show: (ready: boolean) => void;
    const ready = new Promise<boolean>(resolve => { show = resolve; });
    const wait = vi.spyOn(chartViewportQueue, 'wait').mockReturnValue({ ready, cancel: vi.fn() });
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({ eChartsLoader: loader as any, deferUntilNearViewport: true });
    const container = document.createElement('div');
    const old = controller.init(container);
    const latest = controller.init(container);
    expect(loader.init).not.toHaveBeenCalled();
    show!(true);
    await expect(old).resolves.toBeNull();
    await expect(latest).resolves.toBe(chartMock);
    expect(loader.init).toHaveBeenCalledOnce();
    await expect(controller.init(container)).resolves.toBe(chartMock);
    expect(wait).toHaveBeenCalledOnce();
    controller.dispose(); wait.mockRestore();
  });

  it('cancels an off-screen chart without mounting it after disposal', async () => {
    let finish: (ready: boolean) => void;
    const ready = new Promise<boolean>(resolve => { finish = resolve; });
    const cancel = vi.fn(() => finish!(false));
    const wait = vi.spyOn(chartViewportQueue, 'wait').mockReturnValue({ ready, cancel });
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({ eChartsLoader: loader as any, deferUntilNearViewport: true });
    const pending = controller.init(document.createElement('div'));
    controller.dispose();
    await expect(pending).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(loader.init).not.toHaveBeenCalled();
    wait.mockRestore();
  });

  it('should hide the active tooltip after initialization', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');

    await controller.init(container);
    const didHide = controller.hideTooltip();

    expect(didHide).toBe(true);
    expect(chartMock.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' });
  });

  it.each(['light', 'dark'])('styles note tooltips with the initialized %s theme and chart width', async (theme) => {
    const loader = buildLoaderMock();
    const chart = { ...chartMock, on: vi.fn(), off: vi.fn(), getWidth: () => 320 };
    loader.init.mockResolvedValue(chart);
    const controller = new EChartsHostController({ eChartsLoader: loader as any });
    await controller.init(document.createElement('div'), theme);
    controller.setTimelineNotes({
      notes: [{ id: 'a'.repeat(64), category: 'travel', title: 'Trip', startDate: '2026-09-02', endDate: '2026-09-04',
        timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 }], select: vi.fn(), reportRange: vi.fn(),
    });
    controller.setOption({ xAxis: { type: 'time', min: Date.UTC(2026, 8, 1), max: Date.UTC(2026, 8, 10) },
      yAxis: {}, series: [{ type: 'line', data: [] }] });
    const rendered = loader.setOption.mock.calls[0][1] as any;
    expect(rendered.series[1].markLine.data[0].tooltip).toMatchObject(
      buildDashboardEChartsTooltipChrome(buildDashboardEChartsStyleTokens(theme === 'dark', 320)));
    controller.dispose();
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

  it('should subscribe viewport fallback resize handling through the loader', async () => {
    const loader = buildLoaderMock();
    let viewportResizeListener: (() => void) | undefined;
    loader.subscribeToViewportResize.mockImplementation((listener: () => void) => {
      viewportResizeListener = listener;
      return () => {
        viewportResizeListener = undefined;
      };
    });
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 360 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 240 });

    await controller.init(container);

    expect(viewportResizeListener).toBeTypeOf('function');

    viewportResizeListener?.();
    viewportResizeListener?.();
    viewportResizeListener?.();

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
    const unsubscribeTapFeedback = vi.fn();
    loader.attachMobileSeriesTapFeedback.mockReturnValue(unsubscribeTapFeedback);
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
    });
    const container = document.createElement('div');

    await controller.init(container);
    controller.dispose();

    expect(resizeObserverRecords[0].disconnect).toHaveBeenCalledTimes(1);
    expect(loader.dispose).toHaveBeenCalledWith(chartMock);
    expect(loader.subscribeToViewportResize).toHaveBeenCalledTimes(1);
    expect(unsubscribeTapFeedback).toHaveBeenCalledTimes(1);
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

  it('should quietly skip initialization when the loader does not support the runtime', async () => {
    const logger = { error: vi.fn() };
    const loader = buildLoaderMock();
    loader.init.mockResolvedValue(null);
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      logger,
      logPrefix: '[TestChart]'
    });

    const chart = await controller.init(document.createElement('div'));

    expect(chart).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
    expect(loader.subscribeToViewportResize).not.toHaveBeenCalled();
    expect(loader.attachMobileSeriesTapFeedback).not.toHaveBeenCalled();
  });
});
