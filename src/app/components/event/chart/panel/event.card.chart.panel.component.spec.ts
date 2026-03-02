import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DynamicDataLoader, LapTypes, XAxisTypes } from '@sports-alliance/sports-lib';
import { EventCardChartPanelComponent } from './event.card.chart.panel.component';
import { EChartsLoaderService } from '../../../../services/echarts-loader.service';
import { LoggerService } from '../../../../services/logger.service';

describe('EventCardChartPanelComponent', () => {
  let fixture: ComponentFixture<EventCardChartPanelComponent>;
  let component: EventCardChartPanelComponent;
  let intersectionObserverCallbacks: IntersectionObserverCallback[] = [];
  let intersectionObserverObserveSpies: Array<ReturnType<typeof vi.fn>> = [];
  let intersectionObserverDisconnectSpies: Array<ReturnType<typeof vi.fn>> = [];
  let originalIntersectionObserver: typeof IntersectionObserver | undefined;

  const chart = {
    on: vi.fn(),
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
  });

  afterEach(() => {
    if (originalIntersectionObserver) {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    } else {
      delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    }
  });

  function getRenderedOption(): any {
    return eChartsLoaderMock.setOption.mock.calls.find(([, option]) => option?.series)?.[1] as any;
  }

  it('initializes chart host and renders panel option', async () => {
    component.showZoomBar = true;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    expect(eChartsLoaderMock.init).toHaveBeenCalledTimes(1);
    expect(eChartsLoaderMock.connectGroup).toHaveBeenCalledWith('event-zoom-group');
    expect(eChartsLoaderMock.setOption).toHaveBeenCalled();
    expect(chart.on).not.toHaveBeenCalledWith('click', expect.any(Function));
    expect(intersectionObserverObserveSpies).toHaveLength(1);
    expect(intersectionObserverObserveSpies[0]).toHaveBeenCalledTimes(1);

    const option = getRenderedOption();
    expect(option?.xAxis?.min).toBe(0);
    expect(option?.xAxis?.max).toBe(120);
    expect(option?.xAxis?.interval).toBe(15);
    expect(option?.tooltip?.triggerOn).toBe('mousemove|click');
    expect(option?.dataZoom?.[0]?.zoomOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[0]?.filterMode).toBe('filter');
    expect(option?.dataZoom?.[0]?.moveOnMouseMove).toBe(true);
    expect(option?.dataZoom?.[0]?.moveOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[1]?.show).toBe(true);
    expect(option?.dataZoom?.[1]?.filterMode).toBe('filter');
  });

  it('recomputes canonical x-axis interval from the zoomed visible range', async () => {
    component.xDomain = { start: 0, end: 3600 };
    chart.getOption.mockReturnValue({
      dataZoom: [
        {
          startValue: 0,
          endValue: 300,
        }
      ]
    });

    fixture.detectChanges();
    await component.ngAfterViewInit();

    const dataZoomHandler = chart.on.mock.calls.find(([eventName]) => eventName === 'datazoom')?.[1] as (() => void);
    expect(dataZoomHandler).toBeTypeOf('function');

    eChartsLoaderMock.setOption.mockClear();
    dataZoomHandler();

    expect(eChartsLoaderMock.setOption).toHaveBeenCalledWith(
      chart,
      {
        xAxis: {
          interval: 60,
          minInterval: 60,
          maxInterval: 60,
          splitNumber: 6,
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
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = getRenderedOption();
    expect(option?.dataZoom?.[1]?.show).toBe(false);
  });

  it('renders zoom-bar-only mode when panel is null and showZoomBar is true', async () => {
    component.panel = null;
    component.showZoomBar = true;
    component.zoomBarOverviewData = [
      [0, 0.25],
      [60, 0.8],
      [120, 0.35],
    ];
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    expect(option?.dataZoom?.[0]?.labelFormatter(65)).toBe('01:05');
  });

  it('refreshes zoom-bar-only mode when overview data changes', async () => {
    component.panel = null;
    component.showZoomBar = true;
    component.zoomBarOverviewData = [
      [0, 0.1],
      [120, 0.4],
    ];
    fixture.detectChanges();
    await component.ngAfterViewInit();

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

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.series?.[0]?.data).toEqual(component.zoomBarOverviewData);
  });

  it('renders empty-axis no-data option without joining a zoom group when panel is null outside zoom mode', async () => {
    component.panel = null;
    component.showZoomBar = false;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(Array.isArray(option?.xAxis)).toBe(true);
    expect(option?.xAxis).toHaveLength(0);
    expect(Array.isArray(option?.yAxis)).toBe(true);
    expect(option?.yAxis).toHaveLength(0);
    expect(Array.isArray(option?.series)).toBe(true);
    expect(eChartsLoaderMock.connectGroup).not.toHaveBeenCalled();
    expect(eChartsLoaderMock.disconnectGroup).not.toHaveBeenCalled();
  });

  it('enables tooltip hover without requiring a click first', async () => {
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = getRenderedOption();
    expect(option?.tooltip?.triggerOn).toBe('mousemove|click');
  });

  it('hides tooltip when chart panel leaves viewport', async () => {
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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

  it('uses strokeWidth input for line series width', async () => {
    component.strokeWidth = 3.25;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = getRenderedOption();
    expect(option?.series?.[0]?.lineStyle?.width).toBe(3.25);
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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

    let option = getRenderedOption();
    expect(option?.series?.[0]?.markLine?.data).toHaveLength(1);

    eChartsLoaderMock.setOption.mockClear();
    component.showLaps = false;
    component.ngOnChanges({
      showLaps: new SimpleChange(true, false, false),
    });

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

    component.ngOnDestroy();

    expect(eChartsLoaderMock.disconnectGroup).toHaveBeenCalledWith('event-zoom-group');
    expect(intersectionObserverDisconnectSpies).toHaveLength(1);
    expect(intersectionObserverDisconnectSpies[0]).toHaveBeenCalledTimes(1);
  });

  it('hides and restores zoom-bar slider based on viewport visibility', async () => {
    component.panel = null;
    component.showZoomBar = true;
    fixture.detectChanges();
    await component.ngAfterViewInit();

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
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const hostElement = fixture.nativeElement as HTMLElement;
    const bubbleWheelSpy = vi.fn();
    hostElement.addEventListener('wheel', bubbleWheelSpy);

    component.chartDiv.nativeElement.dispatchEvent(new Event('wheel', { bubbles: true, cancelable: true }));

    expect(bubbleWheelSpy).not.toHaveBeenCalled();
  });
});
