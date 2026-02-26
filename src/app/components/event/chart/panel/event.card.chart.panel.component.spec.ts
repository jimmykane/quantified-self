import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DynamicDataLoader, XAxisTypes } from '@sports-alliance/sports-lib';
import { EventCardChartPanelComponent } from './event.card.chart.panel.component';
import { EChartsLoaderService } from '../../../../services/echarts-loader.service';
import { LoggerService } from '../../../../services/logger.service';
import { EventChartSelectionSyncService } from '../event-chart-selection-sync.service';

describe('EventCardChartPanelComponent', () => {
  let fixture: ComponentFixture<EventCardChartPanelComponent>;
  let component: EventCardChartPanelComponent;
  let selectionSyncService: EventChartSelectionSyncService;
  type ChartEventHandler = (params?: unknown) => void;
  let handlers: Record<string, ChartEventHandler>;
  let zrHandlers: Record<string, ChartEventHandler>;

  const zr = {
    on: vi.fn((name: string, callback: ChartEventHandler) => {
      zrHandlers[name] = callback;
    }),
  } as any;

  const chart = {
    on: vi.fn((name: string, callback: ChartEventHandler) => {
      handlers[name] = callback;
    }),
    dispatchAction: vi.fn(),
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false),
    getZr: vi.fn(() => zr),
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
    handlers = {};
    zrHandlers = {};
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      declarations: [EventCardChartPanelComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: eChartsLoaderMock },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() } },
        EventChartSelectionSyncService,
      ],
    }).compileComponents();

    selectionSyncService = TestBed.inject(EventChartSelectionSyncService);
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
    selectionSyncService.clearSelection();
  });

  it('initializes chart host and renders panel option', async () => {
    component.showZoomBar = true;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    expect(eChartsLoaderMock.init).toHaveBeenCalledTimes(1);
    expect(eChartsLoaderMock.connectGroup).toHaveBeenCalledWith('event-zoom-group');
    expect(eChartsLoaderMock.setOption).toHaveBeenCalled();
    expect(chart.on).toHaveBeenCalledWith('brushSelected', expect.any(Function));
    expect(chart.on).toHaveBeenCalledWith('click', expect.any(Function));
    expect(zr.on).toHaveBeenCalledWith('click', expect.any(Function));

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.xAxis?.min).toBe(0);
    expect(option?.xAxis?.max).toBe(120);
    expect(option?.tooltip?.triggerOn).toBe('none');
    expect(option?.dataZoom?.[0]?.zoomOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[0]?.moveOnMouseWheel).toBe(false);
    expect(option?.dataZoom?.[1]?.show).toBe(true);
  });

  it('hides slider zoom bar when showZoomBar is false', async () => {
    component.showZoomBar = false;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.dataZoom?.[1]?.show).toBe(false);
  });

  it('activates official brush cursor mode in select interaction and disables drag-panning', async () => {
    component.interactionMode = 'select';
    fixture.detectChanges();
    await component.ngAfterViewInit();

    const option = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(option?.dataZoom?.[0]?.moveOnMouseMove).toBe(false);
    expect(option?.brush?.throttleType).toBe('fixRate');
    expect(option?.brush?.throttleDelay).toBe(16);
    expect(chart.dispatchAction).toHaveBeenCalledWith({
      type: 'takeGlobalCursor',
      key: 'brush',
      brushOption: {
        brushType: 'lineX',
        brushMode: 'single',
        xAxisIndex: 0,
      },
    });
  });

  it('resets zoom to full domain when reset token changes', async () => {
    component.showZoomBar = true;
    fixture.detectChanges();
    await component.ngAfterViewInit();

    component.zoomResetVersion = 1;
    component.ngOnChanges({
      zoomResetVersion: {
        previousValue: 0,
        currentValue: 1,
        firstChange: false,
        isFirstChange: () => false,
      }
    } as any);

    expect(chart.dispatchAction).toHaveBeenCalledWith(
      {
        type: 'dataZoom',
        startValue: 0,
        endValue: 120,
      },
      { silent: true },
    );
  });

  it('applies shared selection service range with silent brush updates', async () => {
    component.interactionMode = 'select';
    fixture.detectChanges();
    await component.ngAfterViewInit();

    chart.dispatchAction.mockClear();
    selectionSyncService.setSelection({ start: 12, end: 24 });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(chart.dispatchAction).toHaveBeenCalledWith(
      {
        type: 'brush',
        escapeConnect: true,
        areas: [{
          brushType: 'lineX',
          xAxisIndex: 0,
          coordRange: [12, 24],
        }],
      },
      { silent: true },
    );
  });

  it('clears shared selection when clicking outside the brushed area', async () => {
    component.interactionMode = 'select';
    fixture.detectChanges();
    await component.ngAfterViewInit();

    selectionSyncService.setSelection({ start: 12, end: 24 });
    expect(selectionSyncService.selectionRange()).toEqual({ start: 12, end: 24 });

    handlers.brushSelected({ batch: [{ areas: [] }] });

    expect(selectionSyncService.selectionRange()).toBeNull();
  });

  it('starts pointer sync only after chart click', async () => {
    const emitSpy = vi.spyOn(component.cursorPositionChange, 'emit');

    fixture.detectChanges();
    await component.ngAfterViewInit();
    await new Promise(resolve => setTimeout(resolve, 0));

    handlers.updateAxisPointer({ axesInfo: [{ value: 33 }] });
    expect(emitSpy).not.toHaveBeenCalled();

    zrHandlers.click({});
    const reRenderedOption = eChartsLoaderMock.setOption.mock.calls.at(-1)?.[1] as any;
    expect(reRenderedOption?.tooltip?.triggerOn).toBe('mousemove|click');

    handlers.updateAxisPointer({ axesInfo: [{ value: 33 }] });
    expect(emitSpy).toHaveBeenCalledWith(33);
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

    getDataInstanceSpy.mockRestore();
  });

  it('disconnects zoom group on destroy', async () => {
    fixture.detectChanges();
    await component.ngAfterViewInit();

    component.ngOnDestroy();

    expect(eChartsLoaderMock.disconnectGroup).toHaveBeenCalledWith('event-zoom-group');
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
