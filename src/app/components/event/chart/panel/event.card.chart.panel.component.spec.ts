import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChartCursorBehaviours, DynamicDataLoader, LapTypes, XAxisTypes } from '@sports-alliance/sports-lib';
import { EventCardChartPanelComponent } from './event.card.chart.panel.component';
import { EChartsLoaderService } from '../../../../services/echarts-loader.service';
import { LoggerService } from '../../../../services/logger.service';
import { getOrCreateEChartsTooltipHost } from '../../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../../helpers/echarts-tooltip-position.helper';

describe('EventCardChartPanelComponent', () => {
  let fixture: ComponentFixture<EventCardChartPanelComponent>;
  let component: EventCardChartPanelComponent;
  let intersectionObserverCallbacks: IntersectionObserverCallback[] = [];
  let intersectionObserverObserveSpies: Array<ReturnType<typeof vi.fn>> = [];
  let intersectionObserverDisconnectSpies: Array<ReturnType<typeof vi.fn>> = [];
  let originalIntersectionObserver: typeof IntersectionObserver | undefined;

  const chart = {
    on: vi.fn(),
    off: vi.fn(),
    dispatchAction: vi.fn(),
    getOption: vi.fn().mockReturnValue({
      dataZoom: [
        {
          startValue: 0,
          endValue: 120,
        }
      ]
    }),
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false),
  } as any;

  const eChartsLoaderMock = {
    init: vi.fn().mockResolvedValue(chart),
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    subscribeToViewportResize: vi.fn(() => () => { }),
    connectGroup: vi.fn().mockResolvedValue(undefined),
    disconnectGroup: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    intersectionObserverCallbacks = [];
    intersectionObserverObserveSpies = [];
    intersectionObserverDisconnectSpies = [];
    originalIntersectionObserver = globalThis.IntersectionObserver;

    class IntersectionObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn().mockReturnValue([]);
      root = null;
      rootMargin = '';
      thresholds = [0.1];

      constructor(callback: IntersectionObserverCallback) {
        intersectionObserverCallbacks.push(callback);
        intersectionObserverObserveSpies.push(this.observe);
        intersectionObserverDisconnectSpies.push(this.disconnect);
      }
    }

    globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

    await TestBed.configureTestingModule({
      declarations: [EventCardChartPanelComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: eChartsLoaderMock },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCardChartPanelComponent);
    component = fixture.componentInstance;
    component.panel = {
      dataType: 'power',
      displayName: 'Power',
      unit: 'W',
      colorGroupKey: 'Power',
      minX: 0,
      maxX: 100,
      series: [
        {
          id: 'a1::power',
          activityID: 'a1',
          activityName: 'Garmin',
          color: '#ff0000',
          streamType: 'power',
          displayName: 'Power',
          unit: 'W',
          points: [
            { x: 0, y: 100, time: 0 },
            { x: 10, y: 120, time: 10 },
          ],
        }
      ]
    };
    component.xAxisType = XAxisTypes.Duration;
    component.xDomain = { start: 0, end: 120 };
    component.zoomGroupId = 'event-zoom-group';
    component.cursorBehaviour = ChartCursorBehaviours.ZoomX;
  });

  afterEach(() => {
    if (originalIntersectionObserver) {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    } else {
      delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    }
  });

  async function flushQueuedChartRefreshes(iterations = 4): Promise<void> {
    for (let index = 0; index < iterations; index += 1) {
      await fixture.whenStable();
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  async function waitForChartStabilization(iterations = 6): Promise<void> {
    for (let index = 0; index < iterations; index += 1) {
      await fixture.whenStable();
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  async function renderComponent(): Promise<void> {
    fixture.detectChanges();
    await waitForChartStabilization();
  }

  function getRenderedOption(): any {
    return eChartsLoaderMock.setOption.mock.calls.findLast(([, option]) => option?.series)?.[1] as any;
  }

  it('initializes chart host and renders panel option', async () => {
    component.showZoomBar = true;
    await renderComponent();

    expect(eChartsLoaderMock.init).toHaveBeenCalledTimes(2);
    expect(eChartsLoaderMock.connectGroup).toHaveBeenCalledWith('event-zoom-group');
    expect(eChartsLoaderMock.setOption).toHaveBeenCalled();
    expect(chart.on).not.toHaveBeenCalledWith('click', expect.any(Function));
    expect(intersectionObserverObserveSpies).toHaveLength(1);
    expect(intersectionObserverObserveSpies[0]).toHaveBeenCalledTimes(1);

    const option = getRenderedOption();
    expect(option?.xAxis?.min).toBe(0);
    expect(option?.xAxis?.max).toBe(120);
    expect(option?.xAxis?.interval).toBe(15);
    expect(option?.yAxis?.interval).toBe(5);
    expect(option?.tooltip?.renderMode).toBe('html');
    expect(option?.tooltip?.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(option?.tooltip?.confine).toBe(false);
    expect(option?.tooltip?.position).toBe(getViewportConstrainedTooltipPosition);
    expect(option?.tooltip?.triggerOn).toBe('mousemove|click');
    expect(option?.brush?.brushMode).toBe('single');
    expect(option?.dataZoom?.[0]?.zoomOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[0]?.disabled).toBe(false);
    expect(option?.dataZoom?.[0]?.filterMode).toBe('filter');
    expect(option?.dataZoom?.[0]?.moveOnMouseMove).toBe(true);
    expect(option?.dataZoom?.[0]?.moveOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[1]?.show).toBe(true);
    expect(option?.dataZoom?.[1]?.filterMode).toBe('filter');
  });

  it('serializes queued chart refresh requests', async () => {
    const refreshOrder: string[] = [];
    (component as any).refreshChart = vi.fn(() => {
      refreshOrder.push('refresh-start');
      if (refreshOrder.filter((entry) => entry === 'refresh-start').length === 1) {
        (component as any).queueChartRefresh('nested');
      }
      refreshOrder.push('refresh-end');
    });
    (component as any).syncViewportObserver = vi.fn(() => {
      refreshOrder.push('sync');
    });

    (component as any).queueChartRefresh('first');
    (component as any).queueChartRefresh('second');
    await flushQueuedChartRefreshes();

    expect((component as any).refreshChart).toHaveBeenCalledTimes(3);
    expect(refreshOrder).toEqual([
      'refresh-start',
      'refresh-end',
      'sync',
      'refresh-start',
      'refresh-end',
      'sync',
      'refresh-start',
      'refresh-end',
      'sync',
    ]);
  });

  it('recomputes canonical x-axis interval and visible-range y-axis scale from the zoomed visible range', async () => {
    component.xDomain = { start: 0, end: 3600 };
    chart.getOption.mockReturnValue({
      dataZoom: [
        {
          startValue: 0,
          endValue: 300,
        }
      ]
    });

    await renderComponent();

    const dataZoomHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'datazoom')?.[1] as (() => void);
    expect(dataZoomHandler).toBeTypeOf('function');

    eChartsLoaderMock.setOption.mockClear();
    dataZoomHandler();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(eChartsLoaderMock.setOption).toHaveBeenCalledTimes(1);
    expect(eChartsLoaderMock.setOption).toHaveBeenNthCalledWith(
      1,
      chart,
      {
        xAxis: {
          interval: 60,
          minInterval: 60,
          maxInterval: 60,
          splitNumber: 6,
        },
        yAxis: {
          inverse: false,
          interval: 5,
          min: 95,
          max: 125,
        }
      },
      {
        notMerge: false,
        lazyUpdate: true,
        silent: true,
      }
    );
  });

  it('hides slider zoom bar when showZoomBar is false', async () => {
    component.showZoomBar = false;
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.dataZoom?.[1]?.show).toBe(false);
  });

  it('applies series fill opacity to rendered event line series', async () => {
    component.fillOpacity = 0.4;
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.series?.[0]?.areaStyle).toEqual(
      expect.objectContaining({
        color: '#ff0000',
        opacity: 0.4,
      })
    );
  });

  it('switches to selection mode with native brush and disables inside zoom', async () => {
    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.dataZoom?.[0]?.disabled).toBe(true);
    expect(chart.dispatchAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'takeGlobalCursor',
        key: 'brush',
        brushOption: expect.objectContaining({ brushType: 'lineX' }),
      })
    );
  });

  it('uses brush drag to trigger native dataZoom updates in zoom mode', async () => {
    component.cursorBehaviour = ChartCursorBehaviours.ZoomX;
    const emitSpy = vi.spyOn(component.zoomRangeChange, 'emit');
    await renderComponent();

    chart.dispatchAction.mockClear();
    const brushEndHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'brushEnd')?.[1] as ((params: any) => void);
    expect(brushEndHandler).toBeTypeOf('function');

    brushEndHandler({
      areas: [
        {
          coordRange: [15, 75],
        }
      ]
    });

    expect(chart.dispatchAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'brush',
        areas: [],
      })
    );
    expect(chart.dispatchAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'dataZoom',
        startValue: 15,
        endValue: 75,
      })
    );
    expect(emitSpy).toHaveBeenCalledWith({ start: 15, end: 75 });
  });

  it('emits normalized preview range from brush events in selection mode', async () => {
    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    const emitSpy = vi.spyOn(component.previewRangeChange, 'emit');
    await renderComponent();

    const brushHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'brush')?.[1] as ((params: any) => void);
    expect(brushHandler).toBeTypeOf('function');

    brushHandler({
      areas: [
        {
          coordRange: [20, 60],
        }
      ]
    });

    expect(emitSpy).toHaveBeenCalledWith({ start: 20, end: 60 });
  });

  it('commits the selected range on brush end in selection mode', async () => {
    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    const previewEmitSpy = vi.spyOn(component.previewRangeChange, 'emit');
    const selectedEmitSpy = vi.spyOn(component.selectedRangeChange, 'emit');
    await renderComponent();

    const brushEndHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'brushEnd')?.[1] as ((params: any) => void);
    expect(brushEndHandler).toBeTypeOf('function');

    brushEndHandler({
      areas: [
        {
          coordRange: [20, 60],
        }
      ]
    });

    expect(previewEmitSpy).toHaveBeenCalledWith({ start: 20, end: 60 });
    expect(selectedEmitSpy).toHaveBeenCalledWith({ start: 20, end: 60 });
  });

  it('applies incoming shared selection range with official brush action', async () => {
    component.cursorBehaviour = ChartCursorBehaviours.SelectX;
    await renderComponent();

    chart.dispatchAction.mockClear();
    component.selectedRange = { start: 25, end: 55 };
    component.ngOnChanges({
      selectedRange: new SimpleChange(null, component.selectedRange, false),
    });

    expect(chart.dispatchAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'brush',
        areas: [
          expect.objectContaining({
            brushType: 'lineX',
            coordRange: [25, 55],
          })
        ],
      })
    );
  });

  it('renders zoom-bar-only mode when panel is null and showZoomBar is true', async () => {
    component.panel = null;
    component.showZoomBar = true;
    component.showLaps = true;
    component.lapTypes = [LapTypes.AutoLap];
    component.lapMarkers = [
      {
        xValue: 60,
        label: 'Lap 1',
        color: '#00ff00',
        lapType: 'auto',
        lapNumber: 1,
        activityID: 'a1',
        activityName: 'Garmin',
        tooltipTitle: 'Lap 1',
        tooltipDetails: [
          { label: 'Duration', value: '01:00' }
        ]
      }
    ];
    component.zoomBarOverviewData = [
      [0, 0.25],
      [60, 0.8],
      [120, 0.35],
    ];
    await renderComponent();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.tooltip?.show).toBe(false);
    expect(option?.xAxis?.show).toBe(false);
    expect(option?.dataZoom?.[0]?.type).toBe('slider');
    expect(option?.dataZoom?.[0]?.show).toBe(true);
    expect(option?.dataZoom?.[0]?.filterMode).toBe('filter');
    expect(option?.dataZoom?.[0]?.showDataShadow).toBe(true);
    expect(option?.dataZoom?.[0]?.showDetail).toBe(true);
    expect(option?.dataZoom?.[0]?.height).toBe(24);
    expect(option?.dataZoom?.[0]?.handleSize).toBe(24);
    expect(option?.series?.[0]?.data).toEqual(component.zoomBarOverviewData);
    expect(option?.series?.[0]?.markLine?.data).toEqual([
      expect.objectContaining({
        xAxis: 60,
        name: 'Lap 1',
      })
    ]);
    expect(option?.dataZoom?.[0]?.labelFormatter(65)).toBe('01:05');
  });

  it('refreshes zoom-bar-only mode when overview data changes', async () => {
    component.panel = null;
    component.showZoomBar = true;
    component.zoomBarOverviewData = [
      [0, 0.1],
      [120, 0.4],
    ];
    await renderComponent();

    eChartsLoaderMock.setOption.mockClear();
    component.zoomBarOverviewData = [
      [0, 0.2],
      [120, 0.9],
    ];

    component.ngOnChanges({
      zoomBarOverviewData: new SimpleChange(
        [[0, 0.1], [120, 0.4]],
        component.zoomBarOverviewData,
        false
      ),
    });
    await flushQueuedChartRefreshes();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.series?.[0]?.data).toEqual(component.zoomBarOverviewData);
  });

  it('emits canonical zoom range from the zoom bar on datazoom', async () => {
    component.panel = null;
    component.showZoomBar = true;
    const emitSpy = vi.spyOn(component.zoomRangeChange, 'emit');
    chart.getOption.mockReturnValue({
      dataZoom: [
        {
          startValue: 15,
          endValue: 75,
        }
      ]
    });

    await renderComponent();

    const dataZoomHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'datazoom')?.[1] as (() => void);
    expect(dataZoomHandler).toBeTypeOf('function');

    dataZoomHandler();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(emitSpy).toHaveBeenCalledWith({ start: 15, end: 75 });
  });

  it('renders empty-axis no-data option without joining a zoom group when panel is null outside zoom mode', async () => {
    component.panel = null;
    component.showZoomBar = false;
    await renderComponent();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(Array.isArray(option?.xAxis)).toBe(true);
    expect(option?.xAxis).toHaveLength(0);
    expect(Array.isArray(option?.yAxis)).toBe(true);
    expect(option?.yAxis).toHaveLength(0);
    expect(Array.isArray(option?.series)).toBe(true);
    expect(eChartsLoaderMock.connectGroup).not.toHaveBeenCalled();
    expect(eChartsLoaderMock.disconnectGroup).not.toHaveBeenCalled();
  });

  it('replays stored zoom range once when a hidden panel becomes visible again', async () => {
    await renderComponent();

    chart.dispatchAction.mockClear();
    chart.group = undefined;
    (component as any).connectedZoomGroupId = null;
    (component as any).viewportVisible = false;
    (component as any).zoomSyncVisibleForViewport = false;
    component.sharedZoomRange = { start: 20, end: 60 };

    const viewportCallback = intersectionObserverCallbacks[0];
    expect(viewportCallback).toBeTypeOf('function');

    viewportCallback([
      { isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry
    ], {} as IntersectionObserver);

    expect(chart.dispatchAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dataZoom',
        startValue: 20,
        endValue: 60,
      })
    );
    expect(eChartsLoaderMock.connectGroup).toHaveBeenLastCalledWith('event-zoom-group');
  });

  it('enables tooltip hover without requiring a click first', async () => {
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.tooltip?.triggerOn).toBe('mousemove|click');
  });

  it('keeps axis-pointer cursor emission disabled by default', async () => {
    await renderComponent();

    expect(chart.on).not.toHaveBeenCalledWith('updateAxisPointer', expect.any(Function));
  });

  it('binds axis-pointer cursor emission when enabled and forwards pointer values', async () => {
    component.emitAxisPointerCursor = true;
    const emitSpy = vi.spyOn(component.cursorPositionChange, 'emit');

    await renderComponent();

    const axisPointerHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'updateAxisPointer')?.[1] as ((params: any) => void);
    expect(axisPointerHandler).toBeTypeOf('function');

    axisPointerHandler({
      axesInfo: [{ value: 42 }],
    });

    expect(emitSpy).toHaveBeenCalledWith(42);
  });

  it('binds and unbinds axis-pointer cursor emission when the input toggles', async () => {
    await renderComponent();

    chart.on.mockClear();
    component.emitAxisPointerCursor = true;
    component.ngOnChanges({
      emitAxisPointerCursor: new SimpleChange(false, true, false),
    });

    const axisPointerHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'updateAxisPointer')?.[1];
    expect(axisPointerHandler).toBeTypeOf('function');

    chart.off.mockClear();
    component.emitAxisPointerCursor = false;
    component.ngOnChanges({
      emitAxisPointerCursor: new SimpleChange(true, false, false),
    });

    expect(chart.off).toHaveBeenCalledWith('updateAxisPointer', axisPointerHandler);
  });

  it('hides tooltip when chart panel leaves viewport', async () => {
    await renderComponent();

    expect(intersectionObserverCallbacks).toHaveLength(1);
    intersectionObserverCallbacks[0]([
      { isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry
    ], {} as IntersectionObserver);

    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' });
    expect(eChartsLoaderMock.disconnectGroup).toHaveBeenCalledWith('event-zoom-group');
    expect(eChartsLoaderMock.setOption).toHaveBeenCalledWith(
      chart,
      { tooltip: { show: false } },
      expect.objectContaining({ lazyUpdate: true, silent: true })
    );
  });

  it('restores tooltip when chart panel re-enters viewport', async () => {
    await renderComponent();

    expect(intersectionObserverCallbacks).toHaveLength(1);
    intersectionObserverCallbacks[0]([
      { isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry
    ], {} as IntersectionObserver);
    intersectionObserverCallbacks[0]([
      { isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry
    ], {} as IntersectionObserver);

    expect(eChartsLoaderMock.connectGroup).toHaveBeenCalledTimes(2);
    expect(eChartsLoaderMock.connectGroup).toHaveBeenNthCalledWith(2, 'event-zoom-group');
    expect(eChartsLoaderMock.setOption).toHaveBeenCalledWith(
      chart,
      { tooltip: { show: true } },
      expect.objectContaining({ lazyUpdate: true, silent: true })
    );
  });

  it('formats y-axis labels without units', async () => {
    await renderComponent();

    const option = getRenderedOption();
    const formatter = option?.yAxis?.axisLabel?.formatter as ((value: number) => string);
    const getDataInstanceSpy = vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockReturnValue({
      getDisplayValue: () => '12.3',
      getDisplayUnit: () => 'km/h',
    } as any);

    expect(formatter(12.3)).toBe('12.3');
    expect(formatter(12.3)).toBe('12.3');
    expect(getDataInstanceSpy).toHaveBeenCalledTimes(1);

    getDataInstanceSpy.mockRestore();
  });

  it('computes range stats for the current selected range', async () => {
    const getDataInstanceSpy = vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockImplementation((_type: string, value: number) => ({
      getDisplayValue: () => value.toFixed(0),
      getDisplayUnit: () => 'u',
    } as any));

    await renderComponent();

    component.selectedRange = { start: 0, end: 10 };
    component.ngOnChanges({
      selectedRange: new SimpleChange(null, component.selectedRange, false),
    });

    expect(component.rangeStats).toHaveLength(1);
    expect(component.rangeStats[0].min.value).toBe('100');
    expect(component.rangeStats[0].avg.value).toBe('110');
    expect(component.rangeStats[0].max.value).toBe('120');

    getDataInstanceSpy.mockRestore();
  });

  it('exposes selection start/end/span labels for the compact range readout', () => {
    component.xAxisType = XAxisTypes.Duration;
    component.selectedRange = { start: 65, end: 140 };

    expect(component.selectedRangeStartLabel).toBe('01:05');
    expect(component.selectedRangeEndLabel).toBe('02:20');
    expect(component.selectedRangeSpanLabel).toBe('01:15');
  });

  it('hides activity names in selection stats when tooltip activity names are disabled', async () => {
    const getDataInstanceSpy = vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType').mockImplementation((_type: string, value: number) => ({
      getDisplayValue: () => value.toFixed(0),
      getDisplayUnit: () => 'u',
    } as any));

    component.showActivityNamesInTooltip = false;
    await renderComponent();

    component.selectedRange = { start: 0, end: 10 };
    component.ngOnChanges({
      selectedRange: new SimpleChange(null, component.selectedRange, false),
    });
    fixture.detectChanges();

    expect(component.rangeStats).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.event-chart-panel__activity')).toBeNull();

    getDataInstanceSpy.mockRestore();
  });

  it('uses strokeWidth input for line series width', async () => {
    component.strokeWidth = 3.25;
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.series?.[0]?.lineStyle?.width).toBe(3.25);
  });

  it('renders a per-panel watermark graphic in the lower-right plot area', async () => {
    component.waterMark = 'Dimitrios';
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.graphic).toEqual([
      expect.objectContaining({
        type: 'text',
        right: 8,
        top: 10,
        style: expect.objectContaining({
          text: 'Dimitrios',
          font: '600 16px "Barlow Condensed", sans-serif',
        }),
      })
    ]);
  });

  it('does not render a watermark on the zoom bar', async () => {
    component.panel = null;
    component.showZoomBar = true;
    component.waterMark = 'Dimitrios';
    await renderComponent();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.graphic).toBeUndefined();
  });

  it('renders lap markers when configured lap types use enum aliases', async () => {
    component.showZoomBar = false;
    component.showLaps = true;
    component.lapTypes = [LapTypes.AutoLap];
    component.lapMarkers = [
      {
        xValue: 5,
        label: 'Lap 1',
        color: '#00ff00',
        lapType: 'auto',
        lapNumber: 1,
        activityID: 'a1',
        activityName: 'Garmin',
        tooltipTitle: 'Lap 1',
        tooltipDetails: [
          { label: 'Duration', value: '00:05' }
        ]
      }
    ];
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.series?.[0]?.markLine?.data).toEqual([
      expect.objectContaining({
        xAxis: 5,
        name: 'Lap 1',
      })
    ]);
    expect(option?.series?.[0]?.markLine?.label).toEqual({ show: false });
    expect(option?.series?.[0]?.markLine?.silent).toBe(false);
    expect(option?.series?.[0]?.markLine?.tooltip).toEqual({ show: false });
  });

  it('filters session end lap markers from the chart even when configured', async () => {
    component.showZoomBar = false;
    component.showLaps = true;
    component.lapTypes = [LapTypes.session_end];
    component.lapMarkers = [
      {
        xValue: 5,
        label: 'Lap 1',
        color: '#00ff00',
        lapType: LapTypes.session_end,
        lapNumber: 1,
        activityID: 'a1',
        activityName: 'Garmin',
        tooltipTitle: 'Lap 1',
        tooltipDetails: []
      }
    ];
    await renderComponent();

    const option = getRenderedOption();
    expect(option?.series?.[0]?.markLine?.data).toEqual([]);
  });

  it('clears lap markers when showLaps is toggled off', async () => {
    component.showZoomBar = false;
    component.showLaps = true;
    component.lapMarkers = [
      {
        xValue: 5,
        label: 'Lap 1',
        color: '#00ff00',
        lapType: LapTypes.Manual,
        lapNumber: 1,
        activityID: 'a1',
        activityName: 'Garmin',
        tooltipTitle: 'Lap 1',
        tooltipDetails: [],
      }
    ];
    await renderComponent();

    let option = getRenderedOption();
    expect(option?.series?.[0]?.markLine?.data).toHaveLength(1);

    eChartsLoaderMock.setOption.mockClear();
    component.showLaps = false;
    component.ngOnChanges({
      showLaps: new SimpleChange(true, false, false),
    });
    await flushQueuedChartRefreshes();

    option = eChartsLoaderMock.setOption.mock.calls.findLast(([, candidate]) => candidate?.series)?.[1] as any;
    expect(option?.series?.[0]?.markLine?.data).toEqual([]);
  });

  it('formats lap marker tooltip content from markLine data', async () => {
    component.showZoomBar = false;
    component.showLaps = true;
    component.lapTypes = [LapTypes.AutoLap];
    component.lapMarkers = [
      {
        xValue: 5,
        label: 'Lap 1',
        color: '#00ff00',
        lapType: 'Autolap',
        lapNumber: 1,
        activityID: 'a1',
        activityName: 'Garmin',
        tooltipTitle: 'Lap 1',
        tooltipDetails: [
          { label: 'Duration', value: '00:05' },
          { label: 'Distance', value: '1.00km' },
          { label: 'Avg Pace', value: '05:00min/km' },
          { label: 'Avg Heart Rate', value: '150bpm' },
          { label: 'Avg Power', value: '250W' },
          { label: 'Ascent', value: '10m' },
          { label: 'Descent', value: '4m' },
          { label: 'Avg Cadence', value: '172spm' }
        ]
      }
    ];
    await renderComponent();

    const tooltipHtml = (component as any).formatLapMarkerTooltip({
      data: component.lapMarkers[0],
      name: 'Lap 1',
    });

    expect(tooltipHtml).toContain('Lap 1');
    expect(tooltipHtml).toContain('Duration: 00:05');
    expect(tooltipHtml).toContain('Distance: 1.00km');
    expect(tooltipHtml).toContain('Avg Pace: 05:00min/km');
    expect(tooltipHtml).toContain('Avg Heart Rate: 150bpm');
    expect(tooltipHtml).toContain('Avg Power: 250W');
    expect(tooltipHtml).toContain('Ascent: 10m');
    expect(tooltipHtml).toContain('Descent: 4m');
    expect(tooltipHtml).toContain('Avg Cadence: 172spm');
  });

  it('omits activity names from the main tooltip when disabled', async () => {
    component.showActivityNamesInTooltip = false;
    await renderComponent();

    const tooltipHtml = (component as any).formatTooltip([
      {
        seriesId: 'a1::power',
        seriesName: 'Garmin',
        color: '#ff0000',
        value: [10, 120],
      }
    ]);

    expect(tooltipHtml).toContain('120');
    expect(tooltipHtml).not.toContain('Garmin:');
  });

  it('shows activity names in the main tooltip when enabled', async () => {
    component.showActivityNamesInTooltip = true;
    await renderComponent();

    const tooltipHtml = (component as any).formatTooltip([
      {
        seriesId: 'a1::power',
        seriesName: 'Garmin',
        color: '#ff0000',
        value: [10, 120],
      }
    ]);

    expect(tooltipHtml).toContain('Garmin:');
  });

  it('skips synced tooltip rows whose series value is null', async () => {
    component.showActivityNamesInTooltip = true;
    await renderComponent();

    const formatSpy = vi.spyOn(component as any, 'formatDataValue');
    const tooltipHtml = (component as any).formatTooltip([
      {
        seriesId: 'a1::power',
        seriesName: 'Garmin',
        color: '#ff0000',
        value: [10, null],
      },
      {
        seriesId: 'a1::power',
        seriesName: 'Garmin',
        color: '#ff0000',
        value: [10, 120],
      }
    ]);

    expect(tooltipHtml).toContain('120');
    expect(tooltipHtml).not.toContain('null');
    expect(formatSpy).toHaveBeenCalledTimes(1);
    expect(formatSpy).toHaveBeenCalledWith('power', 120);
  });

  it('shows lap tooltip locally without propagating to connected charts', async () => {
    component.showZoomBar = false;
    component.showLaps = true;
    component.lapMarkers = [
      {
        xValue: 5,
        label: 'Lap 1',
        color: '#00ff00',
        lapType: 'Autolap',
        lapNumber: 1,
        activityID: 'a1',
        activityName: 'Garmin',
        tooltipTitle: 'Lap 1',
        tooltipDetails: [
          { label: 'Duration', value: '00:05' }
        ]
      }
    ];
    await renderComponent();

    const mousemoveHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'mousemove')?.[1] as ((params: any) => void);
    expect(mousemoveHandler).toBeTypeOf('function');

    mousemoveHandler({
      componentType: 'markLine',
      data: component.lapMarkers[0],
      event: {
        offsetX: 40,
        offsetY: 24,
      }
    });

    expect(chart.dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'showTip',
      x: 52,
      y: 36,
      escapeConnect: true,
    }));
  });

  it('hides local lap tooltip with escapeConnect when leaving the marker', async () => {
    component.showZoomBar = false;
    component.showLaps = true;
    component.lapMarkers = [
      {
        xValue: 5,
        label: 'Lap 1',
        color: '#00ff00',
        lapType: 'Autolap',
        lapNumber: 1,
        activityID: 'a1',
        activityName: 'Garmin',
        tooltipTitle: 'Lap 1',
        tooltipDetails: [
          { label: 'Duration', value: '00:05' }
        ]
      }
    ];
    await renderComponent();

    const mousemoveHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'mousemove')?.[1] as ((params: any) => void);
    mousemoveHandler({
      componentType: 'markLine',
      data: component.lapMarkers[0],
      event: {
        offsetX: 40,
        offsetY: 24,
      }
    });
    chart.dispatchAction.mockClear();

    mousemoveHandler({
      componentType: 'series',
      event: {
        offsetX: 45,
        offsetY: 28,
      }
    });

    expect(chart.dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'hideTip',
      escapeConnect: true,
    }));
  });

  it('disconnects zoom group on destroy', async () => {
    await renderComponent();

    component.ngOnDestroy();

    expect(eChartsLoaderMock.disconnectGroup).toHaveBeenCalledWith('event-zoom-group');
    expect(intersectionObserverDisconnectSpies).toHaveLength(1);
    expect(intersectionObserverDisconnectSpies[0]).toHaveBeenCalledTimes(1);
  });

  it('hides and restores zoom-bar slider based on viewport visibility', async () => {
    component.panel = null;
    component.showZoomBar = true;
    await renderComponent();

    expect(intersectionObserverCallbacks).toHaveLength(1);
    intersectionObserverCallbacks[0]([
      { isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry
    ], {} as IntersectionObserver);
    expect(eChartsLoaderMock.setOption).toHaveBeenCalledWith(
      chart,
      { dataZoom: [{ show: false }] },
      expect.objectContaining({ lazyUpdate: true, silent: true })
    );

    intersectionObserverCallbacks[0]([
      { isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry
    ], {} as IntersectionObserver);
    expect(eChartsLoaderMock.setOption).toHaveBeenCalledWith(
      chart,
      { dataZoom: [{ show: true }] },
      expect.objectContaining({ lazyUpdate: true, silent: true })
    );
  });

  it('stops wheel event propagation on chart container to preserve page scrolling', async () => {
    await renderComponent();

    const hostElement = fixture.nativeElement as HTMLElement;
    const bubbleWheelSpy = vi.fn();
    hostElement.addEventListener('wheel', bubbleWheelSpy);

    component.chartDiv.nativeElement.dispatchEvent(new Event('wheel', { bubbles: true, cancelable: true }));

    expect(bubbleWheelSpy).not.toHaveBeenCalled();
  });
});
