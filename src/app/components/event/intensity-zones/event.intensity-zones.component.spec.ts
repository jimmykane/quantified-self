import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject } from 'rxjs';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';
import { ChartThemes } from '@sports-alliance/sports-lib';

import { EventIntensityZonesComponent } from './event.intensity-zones.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { convertIntensityZonesStatsToEchartsData } from '../../../helpers/intensity-zones-chart-data-helper';

vi.mock('../../../helpers/intensity-zones-chart-data-helper', () => ({
  convertIntensityZonesStatsToEchartsData: vi.fn(),
}));

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: () => void;
};

describe('EventIntensityZonesComponent', () => {
  let fixture: ComponentFixture<EventIntensityZonesComponent>;
  let component: EventIntensityZonesComponent;
  let breakpointSubject: Subject<{ matches: boolean }>;
  let resizeObserverRecords: ResizeObserverRecord[];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;
  let requestAnimationFrameMock: ReturnType<typeof vi.fn>;

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };

  let mockColorService: {
    getColorForZoneHex: ReturnType<typeof vi.fn>;
  };

  let mockLogger: {
    error: ReturnType<typeof vi.fn>;
  };

  const mockedConvert = vi.mocked(convertIntensityZonesStatsToEchartsData);
  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
  };

  const getLastOption = (): Record<string, any> => {
    return mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
  };

  beforeEach(async () => {
    breakpointSubject = new Subject<{ matches: boolean }>();
    resizeObserverRecords = [];
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    globalThis.requestAnimationFrame = requestAnimationFrameMock as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

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

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    };

    mockColorService = {
      getColorForZoneHex: vi.fn().mockReturnValue('#16B4EA'),
    };

    mockLogger = {
      error: vi.fn(),
    };

    mockedConvert.mockReturnValue({
      zones: ['Zone 1', 'Zone 2'],
      series: [
        {
          type: 'Heart Rate',
          values: [100, 200],
          percentages: [33.3333, 66.6666],
        },
      ],
    });

    await TestBed.configureTestingModule({
      declarations: [EventIntensityZonesComponent],
      providers: [
        {
          provide: BreakpointObserver,
          useValue: {
            observe: vi.fn().mockReturnValue(breakpointSubject.asObservable()),
          },
        },
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: AppEventColorService, useValue: mockColorService },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventIntensityZonesComponent);
    component = fixture.componentInstance;
    component.activities = [];
    component.chartTheme = ChartThemes.Material;
    component.useAnimations = false;
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

    document.body.classList.remove('dark-theme');
  });

  it('should initialize ECharts and render options once view is ready', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(1);
    expect(mockLoader.resize).toHaveBeenCalledTimes(1);
    expect(mockedConvert).toHaveBeenCalledWith(component.activities, false);
    expect(option.grid.left).toBe(0);
    expect(option.grid.right).toBe(0);
    expect(option.grid.top).toBe(0);
    expect(option.grid.bottom).toBe(0);
    expect(option.series[0].clip).toBe(false);
    expect(option.series[0].label.position).toBe('right');
    expect(option.series[0].label.align).toBe('left');
    expect(option.yAxis.splitArea.show).toBe(true);
    expect(option.yAxis.splitArea.areaStyle.color).toEqual([
      'rgba(22, 180, 234, 0.12)',
      'rgba(22, 180, 234, 0.12)',
    ]);
    expect(option.legend.show).toBe(false);
    expect(fixture.nativeElement.querySelector('.intensity-zones-helper-text')).toBeNull();
  });

  it('should ignore ngOnChanges before chart initialization', () => {
    component.ngOnChanges({
      activities: new SimpleChange([], [{}], false),
    });

    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should refresh chart for activities, theme, and animation input changes', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    component.ngOnChanges({
      activities: new SimpleChange([], [{}], false),
      chartTheme: new SimpleChange(ChartThemes.Material, ChartThemes.Dark, false),
      useAnimations: new SimpleChange(false, true, false),
    });

    expect(mockLoader.setOption).toHaveBeenCalledTimes(2);
  });

  it('should not refresh chart for unrelated input changes', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const callCountBefore = mockLoader.setOption.mock.calls.length;

    component.ngOnChanges({
      unknown: new SimpleChange(undefined, 123, false),
    } as any);

    expect(mockLoader.setOption).toHaveBeenCalledTimes(callCountBefore);
  });

  it('should switch to short labels when xsmall breakpoint matches', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    breakpointSubject.next({ matches: true });

    expect(mockedConvert).toHaveBeenLastCalledWith(component.activities, true);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(2);
    const option = getLastOption();
    expect(option.grid.right).toBe(0);
    expect(option.grid.bottom).toBe(0);
  });

  it('should apply dark theme styles when chartTheme is dark', async () => {
    component.chartTheme = ChartThemes.Dark;

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    expect(option.tooltip?.backgroundColor).toBe('#303030');
    expect(option.legend?.textStyle?.color).toBe('#ffffff');
    expect(option.yAxis.splitArea.areaStyle.color).toEqual([
      'rgba(22, 180, 234, 0.18)',
      'rgba(22, 180, 234, 0.18)',
    ]);
  });

  it('should apply dark theme styles from body class even with light chartTheme', async () => {
    document.body.classList.add('dark-theme');

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    expect(option.tooltip?.backgroundColor).toBe('#303030');
    expect(option.yAxis?.axisLabel?.color).toBe('#ffffff');
  });

  it('should include zone rich styles from color service', async () => {
    mockedConvert.mockReturnValue({
      zones: ['Zone 1', 'Zone 2', 'Zone 3'],
      series: [
        {
          type: 'Heart Rate',
          values: [30, 20, 10],
          percentages: [50, 33.3333, 16.6667],
        },
      ],
    });

    mockColorService.getColorForZoneHex.mockImplementation((zone: string) => {
      return `color-${zone}`;
    });

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(mockColorService.getColorForZoneHex).toHaveBeenCalledWith('Zone 1');
    expect(mockColorService.getColorForZoneHex).toHaveBeenCalledWith('Zone 2');
    expect(mockColorService.getColorForZoneHex).toHaveBeenCalledWith('Zone 3');
    expect(option.yAxis.axisLabel.rich.zone_0.backgroundColor).toBe('color-Zone 1');
    expect(option.yAxis.axisLabel.rich.zone_0.align).toBe('center');
    expect(option.yAxis.axisLabel.rich.zone_0.verticalAlign).toBe('middle');
    expect(option.yAxis.axisLabel.rich.zone_0.width).toBe(56);
    expect(option.series[0].label.rich.zone_0.width).toBe(22);
    expect(option.series[0].label.rich.zone_2.backgroundColor).toBe('color-Zone 3');
  });

  it('should hide labels for near-zero values', async () => {
    mockedConvert.mockReturnValue({
      zones: ['Zone 1', 'Zone 2'],
      series: [
        {
          type: 'Heart Rate',
          values: [120, 0.05],
          percentages: [99.9, 0.1],
        },
      ],
    });

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    const formatter = option.series[0].label.formatter as (params: { dataIndex: number }) => string;

    expect(formatter({ dataIndex: 1 })).toBe('');
    expect(formatter({ dataIndex: 0 })).toBe('{zone_0|100%}');
  });

  it('should format tooltip content with zone, series, percentage, and duration', async () => {
    mockedConvert.mockReturnValue({
      zones: ['Zone 1', 'Zone 2'],
      series: [
        {
          type: 'Heart Rate',
          values: [120, 120],
          percentages: [50, 50],
        },
      ],
    });

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: { dataIndex: number; seriesIndex: number; marker: string }) => string;

    const formatted = formatter({ dataIndex: 0, seriesIndex: 0, marker: '• ' });

    expect(formatted).toContain('Zone 1');
    expect(formatted).toContain('Heart Rate');
    expect(formatted).toContain('50%');
    expect(formatted).toContain('Time: <b>');
    expect(formatter({ dataIndex: 99, seriesIndex: 0, marker: '' })).toBe('');
  });

  it('should use compact legend labels for common metrics', async () => {
    mockedConvert.mockReturnValue({
      zones: ['Zone 1'],
      series: [
        { type: 'Heart Rate', values: [100], percentages: [50] },
        { type: 'Power', values: [100], percentages: [50] },
        { type: 'Speed', values: [100], percentages: [50] },
      ],
    });

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    expect(option.series[0].name).toBe('HR');
    expect(option.series[1].name).toBe('PWR');
    expect(option.series[2].name).toBe('SPD');
  });

  it('should use consistent percentage rounding between labels and tooltip', async () => {
    mockedConvert.mockReturnValue({
      zones: ['Zone 1'],
      series: [
        {
          type: 'Heart Rate',
          values: [120],
          percentages: [49.6],
        },
      ],
    });

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();
    const labelFormatter = option.series[0].label.formatter as (params: { dataIndex: number }) => string;
    const tooltipFormatter = option.tooltip.formatter as (params: {
      dataIndex: number;
      seriesIndex: number;
      marker: string;
    }) => string;

    const labelText = labelFormatter({ dataIndex: 0 });
    const tooltipText = tooltipFormatter({ dataIndex: 0, seriesIndex: 0, marker: '' });

    expect(labelText).toContain('50%');
    expect(labelText).not.toContain('m');
    expect(tooltipText).toContain('50%');
  });

  it('should handle empty converted data gracefully', async () => {
    mockedConvert.mockReturnValue({
      zones: [],
      series: [],
    });

    fixture.detectChanges();
    await fixture.whenStable();

    const option = getLastOption();

    expect(option.yAxis?.data).toEqual([]);
    expect(option.series).toEqual([]);
  });

  it('should observe container resize and call chart resize', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(resizeObserverRecords).toHaveLength(1);
    const baselineResizeCalls = mockLoader.resize.mock.calls.length;
    const baselineRafCalls = requestAnimationFrameMock.mock.calls.length;

    const observer = resizeObserverRecords[0];
    expect(observer.observe).toHaveBeenCalledWith(component.chartDiv.nativeElement);

    observer.trigger();

    expect(requestAnimationFrameMock.mock.calls.length).toBeGreaterThanOrEqual(baselineRafCalls);
    expect(mockLoader.resize.mock.calls.length).toBeGreaterThanOrEqual(baselineResizeCalls);
  });

  it('should throttle rapid resize observer callbacks to one resize per animation frame', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    let rafHandle = 0;

    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      rafHandle += 1;
      return rafHandle;
    }) as typeof requestAnimationFrame;

    fixture.detectChanges();
    await fixture.whenStable();

    const baselineResizeCalls = mockLoader.resize.mock.calls.length;
    const observer = resizeObserverRecords[0];

    observer.trigger();
    observer.trigger();
    observer.trigger();

    expect(mockLoader.resize).toHaveBeenCalledTimes(baselineResizeCalls);
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](16);

    expect(mockLoader.resize).toHaveBeenCalledTimes(baselineResizeCalls + 1);
  });

  it('should skip ResizeObserver setup when API is unavailable', async () => {
    delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(resizeObserverRecords).toHaveLength(0);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(1);
  });

  it('should log and skip rendering when chart init fails', async () => {
    mockLoader.init.mockRejectedValueOnce(new Error('init failed'));

    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[EventIntensityZonesComponent] Failed to initialize ECharts',
      expect.any(Error)
    );
    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should disconnect observers and dispose chart on destroy', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const observer = resizeObserverRecords[0];
    const renderCallCount = mockLoader.setOption.mock.calls.length;

    component.ngOnDestroy();
    breakpointSubject.next({ matches: true });

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockLoader.dispose).toHaveBeenCalledWith(mockChart);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(renderCallCount);
  });
});
