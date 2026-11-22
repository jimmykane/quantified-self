import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject } from 'rxjs';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';

import { EventIntensityZonesComponent } from './event.intensity-zones.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { convertIntensityZonesStatsToEchartsData } from '../../../helpers/intensity-zones-chart-data-helper';
import { getOrCreateEChartsTooltipHost } from '../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../helpers/echarts-tooltip-position.helper';
import { AppChartSettingsLocalStorageService } from '../../../services/storage/app.chart.settings.local.storage.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

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
  let chartSettings: { getHiddenIntensityZoneMetrics: ReturnType<typeof vi.fn>; setHiddenIntensityZoneMetrics: ReturnType<typeof vi.fn> };
  let haptics: { selection: ReturnType<typeof vi.fn> };

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };

  let mockColorService: {
    getColorForZoneHex: ReturnType<typeof vi.fn>;
  };

  let mockLogger: {
    error: ReturnType<typeof vi.fn>;
  };

  const heartRate = { type: 'Heart Rate', values: [100, 200], percentages: [33.3333, 66.6666] };
  const power = { type: 'Power', values: [250, 50], percentages: [83.3333, 16.6666] };
  const heartRateData = { zones: ['Zone 1', 'Zone 2'], series: [heartRate] };
  const multiMetricData = { ...heartRateData, series: [heartRate, power] };
  const mockedConvert = vi.mocked(convertIntensityZonesStatsToEchartsData);
  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
    dispatchAction: vi.fn(),
  };

  const getLastOption = (): Record<string, any> => {
    return mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
  };

  const waitForChartStabilization = async (): Promise<void> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await fixture.whenStable();
      await Promise.resolve();
      await new Promise<void>(resolve => setTimeout(resolve, 0));

      if (mockLoader.setOption.mock.calls.length > 0 || mockLogger.error.mock.calls.length > 0) {
        return;
      }
    }
  };

  beforeEach(async () => {
    mockChart.dispatchAction.mockClear();
    chartSettings = { getHiddenIntensityZoneMetrics: vi.fn().mockReturnValue([]), setHiddenIntensityZoneMetrics: vi.fn() };
    haptics = { selection: vi.fn() };
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
      subscribeToViewportResize: vi.fn(() => () => { }),
      attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
    };

    mockColorService = {
      getColorForZoneHex: vi.fn().mockReturnValue('#16B4EA'),
    };

    mockLogger = {
      error: vi.fn(),
    };

    mockedConvert.mockReturnValue(heartRateData);

    await TestBed.configureTestingModule({
      imports: [EventIntensityZonesComponent, NoopAnimationsModule],
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
        { provide: AppChartSettingsLocalStorageService, useValue: chartSettings },
        { provide: AppHapticsService, useValue: haptics },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventIntensityZonesComponent);
    component = fixture.componentInstance;
    component.activities = [];
    component.darkTheme = false;
    component.useAnimations = false;
  });

  it('updates selected series and tooltip data without aggregating again or retaining the previous tooltip', async () => {
    mockedConvert.mockReturnValue(multiMetricData);
    component.allowMetricSelection = true;
    fixture.detectChanges();
    await waitForChartStabilization();
    expect(haptics.selection).not.toHaveBeenCalled();
    expect(chartSettings.setHiddenIntensityZoneMetrics).not.toHaveBeenCalled();
    expect(mockChart.dispatchAction).not.toHaveBeenCalled();
    const conversions = mockedConvert.mock.calls.length;

    component.toggleMetric('Heart Rate');
    fixture.detectChanges();
    expect(getLastOption().series).toHaveLength(1);
    expect(getLastOption().series[0].data).toEqual(power.values);
    expect(getLastOption().tooltip.formatter({ dataIndex: 0, seriesIndex: 0, marker: '' })).toContain('Power:');
    expect(getLastOption().tooltip.formatter({ dataIndex: 0, seriesIndex: 0, marker: '' })).toContain('83%');
    expect(chartSettings.setHiddenIntensityZoneMetrics).toHaveBeenLastCalledWith(['Heart Rate']);
    expect(mockedConvert).toHaveBeenCalledTimes(conversions);
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(mockChart.dispatchAction).toHaveBeenCalledExactlyOnceWith({ type: 'hideTip' });
    expect(mockChart.dispatchAction.mock.invocationCallOrder[0]).toBeLessThan(mockLoader.setOption.mock.invocationCallOrder.at(-1)!);

    component.toggleMetric('not recorded');
    expect(haptics.selection).toHaveBeenCalledOnce();
    expect(mockChart.dispatchAction).toHaveBeenCalledOnce();
    component.toggleMetric('Power');
    fixture.detectChanges();
    expect(getLastOption().series).toEqual([]);
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Choose a metric');
    component.toggleMetric('Power');
    expect(getLastOption().series).toHaveLength(1);
  });

  it('restores choices when reopened and preserves hidden metrics absent from this activity', async () => {
    mockedConvert.mockReturnValue(multiMetricData);
    chartSettings.getHiddenIntensityZoneMetrics.mockReturnValue(['Heart Rate', 'Speed']);
    fixture.destroy();
    fixture = TestBed.createComponent(EventIntensityZonesComponent);
    component = fixture.componentInstance;
    component.allowMetricSelection = true;
    fixture.detectChanges();
    await waitForChartStabilization();
    expect(component.selectedMetricCount).toBe(1);
    expect(getLastOption().series.map(series => series.data)).toEqual([power.values]);
    expect(haptics.selection).not.toHaveBeenCalled();
    component.toggleMetric('Heart Rate');
    expect(chartSettings.setHiddenIntensityZoneMetrics).toHaveBeenLastCalledWith(['Speed']);
    expect(getLastOption().series[0].data).toEqual([100, 200]);
  });

  it('shows the sole recorded metric without a picker and restores saved choices when more become available', async () => {
    chartSettings.getHiddenIntensityZoneMetrics.mockReturnValue(['Heart Rate']);
    fixture.componentRef.setInput('allowMetricSelection', true);
    fixture.detectChanges();
    await waitForChartStabilization();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.intensity-metrics-trigger')).toBeNull();
    expect(host.querySelector('.intensity-metric-legend')?.textContent).toContain('Heart rate');
    expect(host.querySelector('.intensity-zones-chart')?.getAttribute('aria-hidden')).toBeNull();
    expect(host.querySelector('.intensity-metrics-empty')).toBeNull();
    expect(getLastOption().series.map(series => series.data)).toEqual([heartRate.values]);

    mockedConvert.mockReturnValue(multiMetricData);
    fixture.componentRef.setInput('activities', []);
    fixture.detectChanges();
    await waitForChartStabilization();
    fixture.detectChanges();

    expect(host.querySelector('.intensity-metrics-trigger')?.textContent).toContain('Metrics · 1');
    expect(getLastOption().series.map(series => series.data)).toEqual([power.values]);
    expect(chartSettings.setHiddenIntensityZoneMetrics).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('retains a metric choice made while the chart is still initializing', async () => {
    mockedConvert.mockReturnValue(multiMetricData);
    let finishLoading!: (chart: typeof mockChart) => void;
    mockLoader.init.mockReturnValue(new Promise<typeof mockChart>(resolve => { finishLoading = resolve; }));
    component.allowMetricSelection = true;
    fixture.detectChanges();

    component.toggleMetric('Heart Rate');
    expect(component.selectedMetricCount).toBe(1);
    expect(mockChart.dispatchAction).not.toHaveBeenCalled();
    expect(mockLoader.setOption).not.toHaveBeenCalled();

    finishLoading(mockChart);
    await waitForChartStabilization();
    expect(getLastOption().series.map(series => series.data)).toEqual([power.values]);
    expect(chartSettings.setHiddenIntensityZoneMetrics).toHaveBeenCalledExactlyOnceWith(['Heart Rate']);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps metric toggles working when browser storage rejects the save and clears the message after recovery', async () => {
    mockedConvert.mockReturnValue(multiMetricData);
    component.allowMetricSelection = true;
    fixture.detectChanges();
    await waitForChartStabilization();
    const error = new DOMException('Storage is unavailable', 'QuotaExceededError');
    chartSettings.setHiddenIntensityZoneMetrics.mockImplementationOnce(() => { throw error; });

    component.toggleMetric('Heart Rate');
    fixture.detectChanges();
    expect(component.selectedMetricCount).toBe(1);
    expect(getLastOption().series.map(series => series.data)).toEqual([power.values]);
    expect(fixture.nativeElement.querySelector('.intensity-metrics-save-error').textContent).toContain('could not be saved');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Could not save metric visibility'), error);
    expect(haptics.selection).toHaveBeenCalledOnce();

    component.toggleMetric('Heart Rate');
    fixture.detectChanges();
    expect(component.selectedMetricCount).toBe(2);
    expect(getLastOption().series.map(series => series.data)).toEqual([heartRate.values, power.values]);
    expect(fixture.nativeElement.querySelector('.intensity-metrics-save-error')).toBeNull();
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('provides a checkmarked metric menu that stays open for multiple choices', async () => {
    mockedConvert.mockReturnValue(multiMetricData);
    component.allowMetricSelection = true;
    fixture.detectChanges();
    await waitForChartStabilization();
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.intensity-metrics-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const choice = document.querySelector('button[role="menuitemcheckbox"]') as HTMLButtonElement;
    expect(choice.getAttribute('aria-checked')).toBe('true');
    choice.click();
    fixture.detectChanges();
    expect(choice.isConnected).toBe(true);
    expect(choice.getAttribute('aria-checked')).toBe('false');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('leaves existing non-selectable chart surfaces unchanged', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();
    expect(fixture.nativeElement.querySelector('.intensity-metrics-trigger')).toBeNull();
    component.toggleMetric('Heart Rate');
    expect(getLastOption().series).toHaveLength(1);
    expect(chartSettings.setHiddenIntensityZoneMetrics).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
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
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(mockedConvert).toHaveBeenCalledWith(component.activities, false);
    expect(option.grid.left).toBe(0);
    expect(option.grid.right).toBe(0);
    expect(option.grid.top).toBe(0);
    expect(option.grid.bottom).toBe(0);
    expect(option.tooltip.renderMode).toBe('html');
    expect(option.tooltip.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(option.tooltip.confine).toBe(false);
    expect(option.tooltip.position).toBe(getViewportConstrainedTooltipPosition);
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
    expect(fixture.nativeElement.querySelector('.intensity-zones-chart').getAttribute('role')).toBe('img');
    expect(fixture.nativeElement.querySelector('.intensity-zones-chart').getAttribute('aria-label'))
      .toContain('Intensity zones');
  });

  it('should sanitize nullish activities input before conversion', async () => {
    component.activities = undefined as unknown as any;

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(mockedConvert).toHaveBeenCalledWith([], false);
  });

  it('should ignore ngOnChanges before chart initialization', () => {
    component.ngOnChanges({
      activities: new SimpleChange([], [{}], false),
    });

    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should refresh chart for activities, theme, and animation input changes', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    component.ngOnChanges({
      activities: new SimpleChange([], [{}], false),
      darkTheme: new SimpleChange(false, true, false),
      useAnimations: new SimpleChange(false, true, false),
    });
    await waitForChartStabilization();

    expect(mockLoader.setOption).toHaveBeenCalledTimes(2);
  });

  it('should not refresh chart for unrelated input changes', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const callCountBefore = mockLoader.setOption.mock.calls.length;

    component.ngOnChanges({
      unknown: new SimpleChange(undefined, 123, false),
    } as any);

    expect(mockLoader.setOption).toHaveBeenCalledTimes(callCountBefore);
  });

  it('should switch to short labels when xsmall breakpoint matches', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    breakpointSubject.next({ matches: true });
    await waitForChartStabilization();

    expect(mockedConvert).toHaveBeenLastCalledWith(component.activities, true);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(2);
    const option = getLastOption();
    expect(option.grid.right).toBe(0);
    expect(option.grid.bottom).toBe(0);
    expect(option.tooltip.renderMode).toBe('html');
    expect(option.tooltip.appendTo).toBeUndefined();
    expect(option.tooltip.confine).toBe(true);
    expect(option.tooltip.position).toBeUndefined();
  });

  it('should use larger zone badges with zero gap in vertical mode', async () => {
    component.orientation = 'vertical';

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(option.grid.left).toBe(-3);
    expect(option.grid.right).toBe(-3);
    expect(option.grid.bottom).toBe(0);
    expect(option.xAxis.axisLabel.margin).toBe(0);
    expect(option.xAxis.axisLabel.rich.zone_0.fontSize).toBe(13);
    expect(option.xAxis.axisLabel.rich.zone_0.width).toBe(64);
    expect(option.xAxis.axisLabel.rich.zone_0.padding).toEqual([2, 6, 2, 6]);
    expect(option.yAxis.max).toBe(216);
    expect(option.series[0].labelLayout({ labelRect: { x: 310, width: 32 } })).toEqual({});
  });

  it('should keep horizontal value axis auto-sized', async () => {
    component.orientation = 'horizontal';

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(option.grid.left).toBe(0);
    expect(option.grid.right).toBe(0);
    expect(option.xAxis.max).toBeUndefined();
  });

  it.each([320, 1312])('should keep a 100%% end badge visible without shortening the plot at %spx', async width => {
    mockedConvert.mockReturnValue({
      zones: ['Zone 1'],
      series: [{ type: 'Heart Rate', values: [1000], percentages: [100] }],
    });
    breakpointSubject.next({ matches: width === 320 });

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const label = option.series[0].label;
    vi.spyOn(component.chartDiv.nativeElement, 'clientWidth', 'get').mockReturnValue(width);
    const labelRect = { x: width - 8, width: 32 };
    const rect = { y: 72, height: 18 };
    const layout = option.series[0].labelLayout({ labelRect, rect });

    expect(label.formatter({ dataIndex: 0 })).toBe('{zone_0|100%}');
    expect(layout.align).toBe('right');
    expect(layout.verticalAlign).toBe('middle');
    expect(layout.y).toBe(81);
    expect(layout.x).toBeLessThanOrEqual(width);
    expect(layout.x - labelRect.width).toBeGreaterThanOrEqual(0);
    expect(option.grid.right).toBe(0);
    expect(option.xAxis.max).toBeUndefined();
    expect(option.series[0].labelLayout({ labelRect: { x: 100, width: 32 } })).toEqual({});

    // The callback reads the current host size, including after a responsive resize.
    vi.spyOn(component.chartDiv.nativeElement, 'clientWidth', 'get').mockReturnValue(width / 2);
    const resizedLayout = option.series[0].labelLayout({ labelRect, rect });
    expect(resizedLayout.align).toBe('right');
    expect(resizedLayout.x).toBeLessThanOrEqual(width / 2);
  });

  it('should apply dark theme styles when darkTheme is enabled', async () => {
    component.darkTheme = true;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.backgroundColor).toBe('transparent');
    expect(option.tooltip?.backgroundColor).toBe('rgba(58,62,68,1)');
    expect(option.legend?.textStyle?.color).toBe('rgba(223,223,225,1)');
    expect(option.yAxis.splitArea.areaStyle.color).toEqual([
      'rgba(22, 180, 234, 0.18)',
      'rgba(22, 180, 234, 0.18)',
    ]);
  });

  it('should enforce full zone split rendering in vertical orientation', async () => {
    component.orientation = 'vertical';
    component.showHeader = false;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.type).toBe('category');
    expect(option.yAxis.type).toBe('value');
    expect(option.xAxis.splitArea.interval).toBe(0);
    expect(option.xAxis.splitLine.interval).toBe(0);
    expect(option.xAxis.axisLabel.interval).toBe(0);
  });

  it('should keep light theme styles when darkTheme is disabled', async () => {

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.tooltip?.backgroundColor).toBe('#ffffff');
    expect(option.yAxis?.axisLabel?.color).toBe('#3c3c41');
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
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockColorService.getColorForZoneHex).toHaveBeenCalledWith('Zone 1');
    expect(mockColorService.getColorForZoneHex).toHaveBeenCalledWith('Zone 2');
    expect(mockColorService.getColorForZoneHex).toHaveBeenCalledWith('Zone 3');
    expect(option.yAxis.axisLabel.rich.zone_0.backgroundColor).toBe('color-Zone 1');
    expect(option.yAxis.axisLabel.rich.zone_0.align).toBe('center');
    expect(option.yAxis.axisLabel.rich.zone_0.verticalAlign).toBe('middle');
    expect(option.yAxis.axisLabel.rich.zone_0.width).toBe(56);
    expect(option.yAxis.axisLabel.rich.zone_0.padding).toEqual([2, 6, 2, 6]);
    expect(option.series[0].label.rich.zone_0.width).toBeUndefined();
    expect(option.series[0].label.rich.zone_0.padding).toEqual([2, 6, 2, 6]);
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
    await waitForChartStabilization();

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
    await waitForChartStabilization();

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
    await waitForChartStabilization();

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
    await waitForChartStabilization();

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
    await waitForChartStabilization();

    const option = getLastOption();

    expect(option.yAxis?.data).toEqual([]);
    expect(option.series).toEqual([]);
  });

  it('should observe container resize and call chart resize', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

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
    await waitForChartStabilization();

    const baselineResizeCalls = mockLoader.resize.mock.calls.length;
    const observer = resizeObserverRecords[0];

    observer.trigger();
    observer.trigger();
    observer.trigger();

    expect(mockLoader.resize).toHaveBeenCalledTimes(baselineResizeCalls);
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](16);
    observer.trigger();

    expect(rafCallbacks).toHaveLength(2);
  });

  it('should skip ResizeObserver setup when API is unavailable', async () => {
    delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(resizeObserverRecords).toHaveLength(0);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(1);
  });

  it('should log and skip rendering when chart init fails', async () => {
    mockLoader.init.mockRejectedValueOnce(new Error('init failed'));

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[EventIntensityZonesComponent] Failed to initialize ECharts',
      expect.any(Error)
    );
    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should disconnect observers and dispose chart on destroy', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const observer = resizeObserverRecords[0];
    const renderCallCount = mockLoader.setOption.mock.calls.length;

    component.ngOnDestroy();
    breakpointSubject.next({ matches: true });

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockLoader.dispose).toHaveBeenCalledWith(mockChart);
    expect(mockLoader.setOption).toHaveBeenCalledTimes(renderCallCount);
  });
});
