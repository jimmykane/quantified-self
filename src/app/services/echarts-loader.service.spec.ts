import { TestBed } from '@angular/core/testing';
import { NgZone, PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EChartsLoaderService, ECHARTS_GLOBAL_FONT_FAMILY } from './echarts-loader.service';

const echartsCoreMock = vi.hoisted(() => ({
  use: vi.fn(),
  init: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  registerTheme: vi.fn(),
}));

const echartsModulesMock = vi.hoisted(() => ({
  barChart: { chart: 'bar' },
  pictorialBarChart: { chart: 'pictorialBar' },
  customChart: { chart: 'custom' },
  pieChart: { chart: 'pie' },
  lineChart: { chart: 'line' },
  scatterChart: { chart: 'scatter' },
  graphicComponent: { component: 'graphic' },
  gridComponent: { component: 'grid' },
  tooltipComponent: { component: 'tooltip' },
  legendComponent: { component: 'legend' },
  titleComponent: { component: 'title' },
  axisPointerComponent: { component: 'axisPointer' },
  markLineComponent: { component: 'markLine' },
  visualMapComponent: { component: 'visualMap' },
  dataZoomComponent: { component: 'dataZoom' },
  brushComponent: { component: 'brush' },
  canvasRenderer: { renderer: 'canvas' },
}));

vi.mock('echarts/core', () => ({
  use: echartsCoreMock.use,
  init: echartsCoreMock.init,
  connect: echartsCoreMock.connect,
  disconnect: echartsCoreMock.disconnect,
  registerTheme: echartsCoreMock.registerTheme,
}));

vi.mock('echarts/charts', () => ({
  BarChart: echartsModulesMock.barChart,
  PictorialBarChart: echartsModulesMock.pictorialBarChart,
  CustomChart: echartsModulesMock.customChart,
  PieChart: echartsModulesMock.pieChart,
  LineChart: echartsModulesMock.lineChart,
  ScatterChart: echartsModulesMock.scatterChart,
}));

vi.mock('echarts/components', () => ({
  GridComponent: echartsModulesMock.gridComponent,
  GraphicComponent: echartsModulesMock.graphicComponent,
  TooltipComponent: echartsModulesMock.tooltipComponent,
  LegendComponent: echartsModulesMock.legendComponent,
  TitleComponent: echartsModulesMock.titleComponent,
  AxisPointerComponent: echartsModulesMock.axisPointerComponent,
  MarkLineComponent: echartsModulesMock.markLineComponent,
  VisualMapComponent: echartsModulesMock.visualMapComponent,
  DataZoomComponent: echartsModulesMock.dataZoomComponent,
  BrushComponent: echartsModulesMock.brushComponent,
}));

vi.mock('echarts/renderers', () => ({
  CanvasRenderer: echartsModulesMock.canvasRenderer,
}));

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe('EChartsLoaderService', () => {
  let service: EChartsLoaderService;
  let zone: NgZone;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;
  let originalVisualViewport: VisualViewport | undefined;
  let windowEventListeners: Map<string, EventListener>;
  let visualViewportEventListeners: Map<string, EventListener>;
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    windowEventListeners = new Map();
    visualViewportEventListeners = new Map();
    rafCallbacks = [];
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    originalVisualViewport = window.visualViewport;

    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
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

    TestBed.configureTestingModule({
      providers: [
        EChartsLoaderService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    service = TestBed.inject(EChartsLoaderService);
    zone = TestBed.inject(NgZone);
  });

  afterEach(() => {
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

    vi.clearAllMocks();
  });

  it('should load ECharts modules once and cache the core module', async () => {
    const firstLoad = await service.load();
    const secondLoad = await service.load();

    expect(firstLoad).toBe(secondLoad);
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(1);
    expect(echartsCoreMock.registerTheme).toHaveBeenCalledTimes(2);
    expect(echartsCoreMock.registerTheme).toHaveBeenNthCalledWith(
      1,
      'quantified-self-light',
      expect.objectContaining({
        textStyle: expect.objectContaining({ fontFamily: ECHARTS_GLOBAL_FONT_FAMILY }),
        legend: expect.objectContaining({
          textStyle: expect.objectContaining({ fontFamily: ECHARTS_GLOBAL_FONT_FAMILY }),
        }),
      }),
    );
    expect(echartsCoreMock.registerTheme).toHaveBeenNthCalledWith(
      2,
      'quantified-self-dark',
      expect.objectContaining({
        textStyle: expect.objectContaining({ fontFamily: ECHARTS_GLOBAL_FONT_FAMILY }),
      }),
    );
    expect(echartsCoreMock.use).toHaveBeenCalledWith([
      echartsModulesMock.barChart,
      echartsModulesMock.pictorialBarChart,
      echartsModulesMock.customChart,
      echartsModulesMock.pieChart,
      echartsModulesMock.lineChart,
      echartsModulesMock.scatterChart,
      echartsModulesMock.graphicComponent,
      echartsModulesMock.gridComponent,
      echartsModulesMock.tooltipComponent,
      echartsModulesMock.legendComponent,
      echartsModulesMock.titleComponent,
      echartsModulesMock.axisPointerComponent,
      echartsModulesMock.markLineComponent,
      echartsModulesMock.visualMapComponent,
      echartsModulesMock.dataZoomComponent,
      echartsModulesMock.brushComponent,
      echartsModulesMock.canvasRenderer,
    ]);
  });

  it('should deduplicate concurrent load calls', async () => {
    const [coreA, coreB, coreC] = await Promise.all([
      service.load(),
      service.load(),
      service.load(),
    ]);

    expect(coreA).toBe(coreB);
    expect(coreB).toBe(coreC);
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(1);
    expect(echartsCoreMock.registerTheme).toHaveBeenCalledTimes(2);
  });

  it('should recover from a failed initial load and allow retry', async () => {
    echartsCoreMock.use.mockImplementationOnce(() => {
      throw new Error('load failed');
    });

    await expect(service.load()).rejects.toThrow('load failed');
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(1);

    const retriedCore = await service.load();

    expect(retriedCore).toBeDefined();
    expect(echartsCoreMock.use).toHaveBeenCalledTimes(2);
  });

  it('should initialize chart instance with theme', async () => {
    const chart = { id: 'chart-1' };
    const container = document.createElement('div');
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container, 'dark');

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'quantified-self-dark', {
      renderer: 'canvas',
      useDirtyRect: false,
    });
    expect(initialized).toBe(chart);
  });

  it('should initialize chart instance with default app theme when theme is not provided', async () => {
    const chart = { id: 'chart-2' };
    const container = document.createElement('div');
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container);

    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'quantified-self-light', {
      renderer: 'canvas',
      useDirtyRect: false,
    });
    expect(initialized).toBe(chart);
  });

  it('should allow callers to override init options such as dirty rect', async () => {
    const chart = { id: 'chart-3' };
    const container = document.createElement('div');
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container, 'dark', { useDirtyRect: true });

    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'quantified-self-dark', {
      renderer: 'canvas',
      useDirtyRect: true,
    });
    expect(initialized).toBe(chart);
  });

  it('should delegate setOption in runOutsideAngular', () => {
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');
    const chart = {
      setOption: vi.fn(),
    } as any;

    service.setOption(chart, { series: [] }, { notMerge: true });

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(chart.setOption).toHaveBeenCalledWith({ series: [] }, { notMerge: true });
  });

  it('should delegate resize in runOutsideAngular', () => {
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');
    const chart = {
      resize: vi.fn(),
    } as any;

    service.resize(chart, { width: 320, height: 200, silent: true });

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(chart.resize).toHaveBeenCalledTimes(1);
    expect(chart.resize).toHaveBeenCalledWith({ width: 320, height: 200, silent: true });
  });

  it('should connect and disconnect ECharts groups in runOutsideAngular', async () => {
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');

    await service.connectGroup('event-zoom-group');
    await service.disconnectGroup('event-zoom-group');

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(echartsCoreMock.connect).toHaveBeenCalledWith('event-zoom-group');
    expect(echartsCoreMock.disconnect).toHaveBeenCalledWith('event-zoom-group');
  });

  it('should keep group connected until last disconnect call', async () => {
    await service.connectGroup('event-zoom-group');
    await service.connectGroup('event-zoom-group');
    expect(echartsCoreMock.connect).toHaveBeenCalledTimes(1);

    await service.disconnectGroup('event-zoom-group');
    expect(echartsCoreMock.disconnect).not.toHaveBeenCalled();

    await service.disconnectGroup('event-zoom-group');
    expect(echartsCoreMock.disconnect).toHaveBeenCalledTimes(1);
    expect(echartsCoreMock.disconnect).toHaveBeenCalledWith('event-zoom-group');
  });

  it('should not disconnect a group that was reconnected while disconnect was awaiting load', async () => {
    const deferredLoad = createDeferredPromise<typeof echartsCoreMock>();
    const loadSpy = vi.spyOn(service, 'load')
      .mockResolvedValueOnce(echartsCoreMock as never)
      .mockImplementationOnce(() => deferredLoad.promise as Promise<never>);

    await service.connectGroup('event-zoom-group');
    expect(echartsCoreMock.connect).toHaveBeenCalledTimes(1);

    const disconnectPromise = service.disconnectGroup('event-zoom-group');
    await Promise.resolve();

    await service.connectGroup('event-zoom-group');
    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(echartsCoreMock.connect).toHaveBeenCalledTimes(1);

    deferredLoad.resolve(echartsCoreMock);
    await disconnectPromise;

    expect(echartsCoreMock.disconnect).not.toHaveBeenCalled();

    await service.disconnectGroup('event-zoom-group');
    expect(echartsCoreMock.disconnect).toHaveBeenCalledTimes(1);
    expect(echartsCoreMock.disconnect).toHaveBeenCalledWith('event-zoom-group');
  });

  it('should dispose active charts and skip already-disposed charts', () => {
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');

    const activeChart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispose: vi.fn(),
    } as any;

    const disposedChart = {
      isDisposed: vi.fn().mockReturnValue(true),
      dispose: vi.fn(),
    } as any;

    service.dispose(activeChart);
    service.dispose(disposedChart);
    service.dispose(null);

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(activeChart.dispose).toHaveBeenCalledTimes(1);
    expect(disposedChart.dispose).not.toHaveBeenCalled();
  });

  it('should bind one set of viewport listeners for all resize subscribers', () => {
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    const unsubscribeFirst = service.subscribeToViewportResize(firstListener);
    const unsubscribeSecond = service.subscribeToViewportResize(secondListener);

    expect(windowEventListeners.has('resize')).toBe(true);
    expect(windowEventListeners.has('orientationchange')).toBe(true);
    expect(visualViewportEventListeners.has('resize')).toBe(true);

    unsubscribeFirst();
    expect(windowEventListeners.has('resize')).toBe(true);

    unsubscribeSecond();
    expect(windowEventListeners.has('resize')).toBe(false);
    expect(windowEventListeners.has('orientationchange')).toBe(false);
    expect(visualViewportEventListeners.has('resize')).toBe(false);
  });

  it('should fan out viewport resizes once per animation frame', () => {
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    service.subscribeToViewportResize(firstListener);
    service.subscribeToViewportResize(secondListener);

    const resizeListener = windowEventListeners.get('resize');
    expect(resizeListener).toBeTypeOf('function');

    resizeListener?.(new Event('resize'));
    resizeListener?.(new Event('resize'));
    resizeListener?.(new Event('resize'));

    expect(rafCallbacks).toHaveLength(1);
    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).not.toHaveBeenCalled();

    rafCallbacks[0](0);

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it('should throw when loading in non-browser platform', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EChartsLoaderService,
        { provide: PLATFORM_ID, useValue: 'server' },
      ],
    });

    const serverService = TestBed.inject(EChartsLoaderService);

    await expect(serverService.load()).rejects.toThrow('ECharts can only be initialized in the browser.');
  });
});
