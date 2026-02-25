import { NgZone } from '@angular/core';
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
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

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
  });

  it('should initialize once and attach a resize observer', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      zone: new NgZone({ enableLongStackTrace: false }),
    });
    const container = document.createElement('div');

    await controller.init(container);
    await controller.init(container);

    expect(loader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(resizeObserverRecords[0].observe).toHaveBeenCalledWith(container);
  });

  it('should no-op setOption before chart initialization', () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      zone: new NgZone({ enableLongStackTrace: false }),
    });

    const didSet = controller.setOption({} as any, { notMerge: true });

    expect(didSet).toBe(false);
    expect(loader.setOption).not.toHaveBeenCalled();
  });

  it('should forward setOption and resize calls after initialization', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      zone: new NgZone({ enableLongStackTrace: false }),
    });
    const container = document.createElement('div');

    await controller.init(container);
    const didSet = controller.setOption({ series: [] } as any, { notMerge: true, lazyUpdate: true });
    controller.scheduleResize();

    expect(didSet).toBe(true);
    expect(loader.setOption).toHaveBeenCalledTimes(1);
    expect(loader.resize).toHaveBeenCalledTimes(1);
  });

  it('should resize from resize observer callback using raf throttling', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      zone: new NgZone({ enableLongStackTrace: false }),
    });
    const container = document.createElement('div');

    await controller.init(container);

    expect(resizeObserverRecords).toHaveLength(1);

    resizeObserverRecords[0].trigger();
    resizeObserverRecords[0].trigger();

    expect(loader.resize).toHaveBeenCalledTimes(1);
  });

  it('should dispose chart and disconnect observers', async () => {
    const loader = buildLoaderMock();
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      zone: new NgZone({ enableLongStackTrace: false }),
    });
    const container = document.createElement('div');

    await controller.init(container);
    controller.dispose();

    expect(resizeObserverRecords[0].disconnect).toHaveBeenCalledTimes(1);
    expect(loader.dispose).toHaveBeenCalledWith(chartMock);
  });

  it('should log initialization failures and return null', async () => {
    const logger = { error: vi.fn() };
    const loader = buildLoaderMock();
    loader.init.mockRejectedValue(new Error('boom'));
    const controller = new EChartsHostController({
      eChartsLoader: loader as any,
      zone: new NgZone({ enableLongStackTrace: false }),
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
