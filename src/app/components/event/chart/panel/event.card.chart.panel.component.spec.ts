import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DynamicDataLoader, XAxisTypes } from '@sports-alliance/sports-lib';
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

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.xAxis?.min).toBe(0);
    expect(option?.xAxis?.max).toBe(120);
    expect(option?.tooltip?.triggerOn).toBe('mousemove|click');
    expect(option?.dataZoom?.[0]?.zoomOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[0]?.filterMode).toBe('filter');
    expect(option?.dataZoom?.[0]?.moveOnMouseMove).toBe(true);
    expect(option?.dataZoom?.[0]?.moveOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[1]?.show).toBe(true);
    expect(option?.dataZoom?.[1]?.filterMode).toBe('filter');
  });

  it('hides slider zoom bar when showZoomBar is false', async () => {
    component.showZoomBar = false;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.dataZoom?.[1]?.show).toBe(false);
  });

  it('renders zoom-bar-only mode when panel is null and showZoomBar is true', async () => {
    component.panel = null;
    component.showZoomBar = true;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.tooltip?.show).toBe(false);
    expect(option?.xAxis?.show).toBe(false);
    expect(option?.dataZoom?.[0]?.type).toBe('slider');
    expect(option?.dataZoom?.[0]?.show).toBe(true);
    expect(option?.dataZoom?.[0]?.filterMode).toBe('filter');
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

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
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

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
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

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.series?.[0]?.lineStyle?.width).toBe(3.25);
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
