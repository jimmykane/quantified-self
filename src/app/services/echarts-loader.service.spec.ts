import { TestBed } from '@angular/core/testing';
import { NgZone, PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EChartsLoaderService } from './echarts-loader.service';
import { AppHapticsService } from './app.haptics.service';

const echartsCoreMock = vi.hoisted(() => ({
  use: vi.fn(),
  init: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
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
  toolboxComponent: { component: 'toolbox' },
  dataZoomComponent: { component: 'dataZoom' },
  brushComponent: { component: 'brush' },
  canvasRenderer: { renderer: 'canvas' },
}));

vi.mock('echarts/core', () => ({
  use: echartsCoreMock.use,
  init: echartsCoreMock.init,
  connect: echartsCoreMock.connect,
  disconnect: echartsCoreMock.disconnect,
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
  ToolboxComponent: echartsModulesMock.toolboxComponent,
  DataZoomComponent: echartsModulesMock.dataZoomComponent,
  BrushComponent: echartsModulesMock.brushComponent,
}));

vi.mock('echarts/renderers', () => ({
  CanvasRenderer: echartsModulesMock.canvasRenderer,
}));

describe('EChartsLoaderService', () => {
  let service: EChartsLoaderService;
  let zone: NgZone;
  let hapticsMock: { selection: ReturnType<typeof vi.fn> };
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;
  let originalVisualViewport: VisualViewport | undefined;
  let windowEventListeners: Map<string, EventListener>;
  let visualViewportEventListeners: Map<string, EventListener>;
  let rafCallbacks: FrameRequestCallback[];

  const setElementSize = (element: HTMLElement, width: number, height: number): void => {
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  };

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
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
      ],
    });

    service = TestBed.inject(EChartsLoaderService);
    zone = TestBed.inject(NgZone);
    hapticsMock = TestBed.inject(AppHapticsService) as unknown as { selection: ReturnType<typeof vi.fn> };
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
      echartsModulesMock.toolboxComponent,
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
    setElementSize(container, 320, 180);
    const runOutsideAngularSpy = vi.spyOn(zone, 'runOutsideAngular');
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container, 'dark');

    expect(runOutsideAngularSpy).toHaveBeenCalled();
    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'dark', {
      renderer: 'canvas',
      useDirtyRect: false,
    });
    expect(initialized).toBe(chart);
  });

  it('should initialize chart instance with default app theme when theme is not provided', async () => {
    const chart = { id: 'chart-2' };
    const container = document.createElement('div');
    setElementSize(container, 320, 180);
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container);

    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, undefined, {
      renderer: 'canvas',
      useDirtyRect: false,
    });
    expect(initialized).toBe(chart);
  });

  it('should allow callers to override init options such as dirty rect', async () => {
    const chart = { id: 'chart-3' };
    const container = document.createElement('div');
    setElementSize(container, 320, 180);
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container, 'dark', { useDirtyRect: true });

    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'dark', {
      renderer: 'canvas',
      useDirtyRect: true,
    });
    expect(initialized).toBe(chart);
  });

  it('should pass fallback init dimensions when the container has not been laid out yet', async () => {
    const chart = { id: 'chart-zero-size' };
    const container = document.createElement('div');
    setElementSize(container, 0, 0);
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container, 'dark');

    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'dark', {
      renderer: 'canvas',
      useDirtyRect: false,
      width: 1,
      height: 1,
    });
    expect(initialized).toBe(chart);
  });

  it('should use bounding rect dimensions before falling back to explicit init size', async () => {
    const chart = { id: 'chart-bounding-rect-size' };
    const container = document.createElement('div');
    setElementSize(container, 0, 0);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 480,
      height: 260,
      top: 0,
      right: 480,
      bottom: 260,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    echartsCoreMock.init.mockReturnValue(chart);

    const initialized = await service.init(container, 'dark');

    expect(echartsCoreMock.init).toHaveBeenCalledWith(container, 'dark', {
      renderer: 'canvas',
      useDirtyRect: false,
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

  it('should trigger haptics for eligible chart interactions and detach on unsubscribe', () => {
    const handlers = new Map<string, (params: unknown) => void>();
    const chart = {
      on: vi.fn((eventName: string, handler: (params: unknown) => void) => {
        handlers.set(eventName, handler);
      }),
      off: vi.fn((eventName: string, handler: (params: unknown) => void) => {
        if (handlers.get(eventName) === handler) {
          handlers.delete(eventName);
        }
      }),
    } as any;

    const unsubscribe = service.attachMobileSeriesTapFeedback(chart);
    const clickHandler = handlers.get('click');
    const dataZoomHandler = handlers.get('datazoom');
    const brushEndHandler = handlers.get('brushEnd');
    const axisPointerHandler = handlers.get('updateAxisPointer');

    expect(chart.on).toHaveBeenCalledWith('click', expect.any(Function));
    expect(chart.on).toHaveBeenCalledWith('datazoom', expect.any(Function));
    expect(chart.on).toHaveBeenCalledWith('brushEnd', expect.any(Function));
    expect(chart.on).toHaveBeenCalledWith('updateAxisPointer', expect.any(Function));
    expect(clickHandler).toBeTypeOf('function');
    expect(dataZoomHandler).toBeTypeOf('function');
    expect(brushEndHandler).toBeTypeOf('function');
    expect(axisPointerHandler).toBeTypeOf('function');

    clickHandler?.({ componentType: 'legend' });
    expect(hapticsMock.selection).not.toHaveBeenCalled();

    clickHandler?.({ componentType: 'series' });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

    clickHandler?.({ componentType: 'xAxis' });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(2);

    clickHandler?.({ componentType: 'yAxis' });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(3);

    dataZoomHandler?.({});
    expect(hapticsMock.selection).toHaveBeenCalledTimes(4);

    dataZoomHandler?.({ $from: 'event-chart-zoom-sync' });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(4);

    dataZoomHandler?.({ $from: 'view-component-inside' });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(5);

    brushEndHandler?.({ areas: [{ coordRange: [10, 20] }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(6);

    brushEndHandler?.({ areas: [] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(6);

    brushEndHandler?.({ $from: 'view-component-brush', areas: [{ coordRange: [10, 20] }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(7);

    brushEndHandler?.({ $from: 'event-chart-selection-sync', areas: [{ coordRange: [10, 20] }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(7);

    brushEndHandler?.({ $from: 'event-chart-brush-zoom', areas: [{ coordRange: [10, 20] }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(7);

    axisPointerHandler?.({ axesInfo: [{ axisDim: 'y', axisIndex: 0, value: 90 }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(7);

    axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 100 }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(8);

    axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 100 }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(8);

    axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 101 }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(9);

    axisPointerHandler?.({ $from: 'event-chart-tooltip-sync', axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 102 }] });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(9);

    unsubscribe();
    expect(chart.off).toHaveBeenCalledWith('click', clickHandler);
    expect(chart.off).toHaveBeenCalledWith('datazoom', dataZoomHandler);
    expect(chart.off).toHaveBeenCalledWith('brushEnd', brushEndHandler);
    expect(chart.off).toHaveBeenCalledWith('updateAxisPointer', axisPointerHandler);
  });

  it('should gate axis-pointer haptics until the first intentional chart interaction when requested', () => {
    let nowMs = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const handlers = new Map<string, (params: unknown) => void>();
      const chart = {
        on: vi.fn((eventName: string, handler: (params: unknown) => void) => {
          handlers.set(eventName, handler);
        }),
        off: vi.fn(),
      } as any;

      service.attachMobileSeriesTapFeedback(chart, {
        axisPointerFeedback: 'afterFirstInteraction',
        clickFeedback: false,
      });
      const clickHandler = handlers.get('click');
      const axisPointerHandler = handlers.get('updateAxisPointer');

      expect(clickHandler).toBeTypeOf('function');
      expect(axisPointerHandler).toBeTypeOf('function');

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 100 }] });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      clickHandler?.({ componentType: 'legend' });
      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 101 }] });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      clickHandler?.({ componentType: 'series' });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 102 }] });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      nowMs = 1300;
      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 103 }] });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 103 }] });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('should preserve click haptics while suppressing the immediate axis-pointer echo when gated', () => {
    let nowMs = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const handlers = new Map<string, (params: unknown) => void>();
      const chart = {
        on: vi.fn((eventName: string, handler: (params: unknown) => void) => {
          handlers.set(eventName, handler);
        }),
        off: vi.fn(),
      } as any;

      service.attachMobileSeriesTapFeedback(chart, {
        axisPointerFeedback: 'afterFirstInteraction',
        clickFeedback: true,
      });
      const clickHandler = handlers.get('click');
      const axisPointerHandler = handlers.get('updateAxisPointer');

      expect(clickHandler).toBeTypeOf('function');
      expect(axisPointerHandler).toBeTypeOf('function');

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 100 }] });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      clickHandler?.({ componentType: 'series' });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 101 }] });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

      nowMs = 1300;
      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 102 }] });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('should skip first chart click haptics when click feedback is armed after first interaction', () => {
    let nowMs = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const handlers = new Map<string, (params: unknown) => void>();
      const chart = {
        on: vi.fn((eventName: string, handler: (params: unknown) => void) => {
          handlers.set(eventName, handler);
        }),
        off: vi.fn(),
      } as any;

      service.attachMobileSeriesTapFeedback(chart, {
        axisPointerFeedback: 'afterFirstInteraction',
        clickFeedback: 'afterFirstInteraction',
      });
      const clickHandler = handlers.get('click');
      const axisPointerHandler = handlers.get('updateAxisPointer');

      expect(clickHandler).toBeTypeOf('function');
      expect(axisPointerHandler).toBeTypeOf('function');

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 100 }] });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      clickHandler?.({ componentType: 'series' });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 101 }] });
      expect(hapticsMock.selection).not.toHaveBeenCalled();

      nowMs = 1300;
      clickHandler?.({ componentType: 'series' });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 102 }] });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

      nowMs = 1600;
      axisPointerHandler?.({ axesInfo: [{ axisDim: 'x', axisIndex: 0, value: 103 }] });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('should trigger surface click fallback for dashboard charts without double-triggering chart clicks', () => {
    let nowMs = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const handlers = new Map<string, (params: unknown) => void>();
      const surfaceHandlers = new Map<string, (params: unknown) => void>();
      const zRender = {
        on: vi.fn((eventName: string, handler: (params: unknown) => void) => {
          surfaceHandlers.set(eventName, handler);
        }),
        off: vi.fn(),
      };
      const chart = {
        on: vi.fn((eventName: string, handler: (params: unknown) => void) => {
          handlers.set(eventName, handler);
        }),
        off: vi.fn(),
        getZr: vi.fn(() => zRender),
      } as any;

      const unsubscribe = service.attachMobileSeriesTapFeedback(chart, {
        axisPointerFeedback: 'always',
        clickFeedback: true,
        surfaceClickFeedback: true,
      });
      const clickHandler = handlers.get('click');
      const surfaceClickHandler = surfaceHandlers.get('click');

      expect(surfaceClickHandler).toBeTypeOf('function');

      surfaceClickHandler?.({ offsetX: 20, offsetY: 10 });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

      clickHandler?.({ componentType: 'series' });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

      nowMs = 1300;
      clickHandler?.({ componentType: 'series' });
      expect(hapticsMock.selection).toHaveBeenCalledTimes(2);

      unsubscribe();
      expect(zRender.off).toHaveBeenCalledWith('click', surfaceClickHandler);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('should trigger surface drag haptics while the dashboard chart surface is actively dragged', () => {
    const surfaceHandlers = new Map<string, (params: unknown) => void>();
    const zRender = {
      on: vi.fn((eventName: string, handler: (params: unknown) => void) => {
        surfaceHandlers.set(eventName, handler);
      }),
      off: vi.fn(),
    };
    const chart = {
      on: vi.fn(),
      off: vi.fn(),
      getZr: vi.fn(() => zRender),
    } as any;

    service.attachMobileSeriesTapFeedback(chart, {
      axisPointerFeedback: 'always',
      surfaceDragFeedback: true,
      surfaceDragThresholdPx: 8,
      surfaceDragBucketPx: 24,
    });
    const surfacePointerDownHandler = surfaceHandlers.get('mousedown');
    const surfacePointerMoveHandler = surfaceHandlers.get('mousemove');
    const surfacePointerUpHandler = surfaceHandlers.get('mouseup');
    const surfaceClickHandler = surfaceHandlers.get('click');

    expect(surfacePointerDownHandler).toBeTypeOf('function');
    expect(surfacePointerMoveHandler).toBeTypeOf('function');
    expect(surfacePointerUpHandler).toBeTypeOf('function');

    surfaceClickHandler?.({ offsetX: 10, offsetY: 10 });
    expect(hapticsMock.selection).not.toHaveBeenCalled();

    surfacePointerMoveHandler?.({ offsetX: 40, offsetY: 10 });
    expect(hapticsMock.selection).not.toHaveBeenCalled();

    surfacePointerDownHandler?.({ offsetX: 10, offsetY: 10 });
    surfacePointerMoveHandler?.({ offsetX: 14, offsetY: 13 });
    expect(hapticsMock.selection).not.toHaveBeenCalled();

    surfacePointerMoveHandler?.({ offsetX: 35, offsetY: 10 });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

    surfacePointerMoveHandler?.({ offsetX: 36, offsetY: 11 });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(1);

    surfacePointerMoveHandler?.({ offsetX: 60, offsetY: 10 });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(2);

    surfacePointerUpHandler?.({});
    surfaceClickHandler?.({ offsetX: 60, offsetY: 10 });
    expect(hapticsMock.selection).toHaveBeenCalledTimes(2);
  });

  it('should throw when loading in non-browser platform', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EChartsLoaderService,
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
      ],
    });

    const serverService = TestBed.inject(EChartsLoaderService);

    await expect(serverService.load()).rejects.toThrow('ECharts can only be initialized in the browser.');
  });

  it('should no-op mobile tap feedback binding on server platform', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EChartsLoaderService,
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
      ],
    });

    const serverService = TestBed.inject(EChartsLoaderService);
    const chart = {
      on: vi.fn(),
      off: vi.fn(),
    } as any;

    const unsubscribe = serverService.attachMobileSeriesTapFeedback(chart);

    expect(chart.on).not.toHaveBeenCalled();
    unsubscribe();
    expect(chart.off).not.toHaveBeenCalled();
  });
});
