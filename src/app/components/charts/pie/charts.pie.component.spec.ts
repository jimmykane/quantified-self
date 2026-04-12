import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataDuration,
  DataDistance,
  DataPaceAvg,
  DataRecoveryTime,
  PaceUnits,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsPieComponent } from './charts.pie.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { formatDashboardNumericValue } from '../../../helpers/dashboard-chart-data.helper';
import { getOrCreateEChartsTooltipHost } from '../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../helpers/echarts-tooltip-position.helper';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

describe('ChartsPieComponent', () => {
  let fixture: ComponentFixture<ChartsPieComponent>;
  let component: ChartsPieComponent;
  let resizeObserverRecords: ResizeObserverRecord[];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
    dispatchAction: vi.fn(),
  };

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    resizeObserverRecords = [];
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    class ResizeObserverMock {
      public observe = vi.fn();
      public disconnect = vi.fn();

      constructor(_: ResizeObserverCallback) {
        resizeObserverRecords.push({
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => { }),
      attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
    };

    await TestBed.configureTestingModule({
      declarations: [ChartsPieComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        {
          provide: AppEventColorService,
          useValue: {
            getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#16B4EA')
          }
        },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsPieComponent);
    component = fixture.componentInstance;
    component.darkTheme = false;
    component.useAnimations = false;
    component.chartDataType = DataDistance.type;
    component.chartDataValueType = ChartDataValueTypes.Total;
    component.chartDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
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

  it('should initialize ECharts and render pie option', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 60, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 40, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(option.tooltip.renderMode).toBe('html');
    expect(option.tooltip.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(option.tooltip.confine).toBe(false);
    expect(option.tooltip.position).toBe(getViewportConstrainedTooltipPosition);
    expect(option.series[0].type).toBe('pie');
    expect(option.series[0].data).toHaveLength(2);
    expect(mockChart.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' });
    expect(mockLoader.setOption.mock.calls.at(-1)?.[2]).toEqual({
      notMerge: false,
      lazyUpdate: false,
      replaceMerge: ['series']
    });
  });

  it('should keep activity-type slices ungrouped', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 90, count: 5 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 5, count: 1 },
      { type: 'Swimming', [ChartDataValueTypes.Total]: 5, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const names = option.series[0].data.map((entry: { name: string }) => entry.name);

    expect(names).toContain('Running');
    expect(names).toContain('Cycling');
    expect(names).toContain('Swimming');
    expect(names).not.toContain('Other');
    expect(option.series[0].data).toHaveLength(3);
  });

  it('should render center sub label as "per activity type" for activity categories', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 60, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 40, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.graphic[0].children[2].style.text).toBe('Total per activity type');
  });

  it('should not group date-type slices', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { type: 1704067200000, time: 1704067200000, [ChartDataValueTypes.Total]: 90, count: 5 },
      { type: 1704153600000, time: 1704153600000, [ChartDataValueTypes.Total]: 5, count: 1 },
      { type: 1704240000000, time: 1704240000000, [ChartDataValueTypes.Total]: 5, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const names = option.series[0].data.map((entry: { name: string }) => entry.name);

    expect(option.series[0].data).toHaveLength(3);
    expect(names).not.toContain('Other');
  });

  it('should render center sub label as "per month" for monthly date categories', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.data = [
      { type: Date.UTC(2024, 0, 1), time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 90, count: 5 },
      { type: Date.UTC(2024, 1, 1), time: Date.UTC(2024, 1, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.graphic[0].children[2].style.text).toBe('Total per month');
  });

  it('should override center summary with recovery-left and total recovery meta', async () => {
    const nowMs = Date.UTC(2024, 0, 3, 12, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    component.enableRecoveryNowMode = true;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { type: Date.UTC(2024, 0, 3), time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 5400, count: 1 },
    ];
    component.recoveryNow = {
      totalSeconds: 5400,
      endTimeMs: nowMs - (10 * 60 * 1000),
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const expectedRemaining = formatDashboardNumericValue(
      DataDuration.type,
      4800,
      undefined as any,
      component.userUnitSettings,
    );
    const expectedTotal = formatDashboardNumericValue(
      DataDuration.type,
      5400,
      undefined as any,
      component.userUnitSettings,
    );
    const recoverySliceNames = option.series[0].data.map((entry: { name: string }) => entry.name);
    expect(option.graphic[0].children[0].style.text).toBe('Recovery Left Now');
    expect(option.graphic[0].children[1].style.text).toBe(expectedRemaining);
    expect(option.graphic[0].children[2].style.text).toBe(`Total recovery: ${expectedTotal}`);
    expect(recoverySliceNames).toEqual(['Left now', 'Elapsed']);

    dateNowSpy.mockRestore();
  });

  it('should compute recovery total from currently active segments only', async () => {
    const nowMs = Date.UTC(2024, 0, 10, 12, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    component.enableRecoveryNowMode = true;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { type: Date.UTC(2024, 0, 10), time: Date.UTC(2024, 0, 10), [ChartDataValueTypes.Total]: 1, count: 1 },
    ];
    component.recoveryNow = {
      totalSeconds: 999999, // legacy aggregate value should not drive curated summary
      endTimeMs: nowMs,
      segments: [
        {
          totalSeconds: 6 * 3600,
          endTimeMs: nowMs - (10 * 3600 * 1000), // expired
        },
        {
          totalSeconds: 5 * 3600,
          endTimeMs: nowMs - (2 * 3600 * 1000), // 3h left
        },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const expectedRemaining = formatDashboardNumericValue(
      DataDuration.type,
      3 * 3600,
      undefined as any,
      component.userUnitSettings,
    );
    const expectedActiveTotal = formatDashboardNumericValue(
      DataDuration.type,
      5 * 3600,
      undefined as any,
      component.userUnitSettings,
    );
    expect(option.graphic[0].children[1].style.text).toBe(expectedRemaining);
    expect(option.graphic[0].children[2].style.text).toBe(`Total recovery: ${expectedActiveTotal}`);
    expect(option.series[0].data[0].value).toBe(3 * 3600);
    expect(option.series[0].data[1].value).toBe(2 * 3600);

    dateNowSpy.mockRestore();
  });

  it('should keep generic summary when recovery mode is disabled for pie charts', async () => {
    component.enableRecoveryNowMode = false;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { type: Date.UTC(2024, 0, 3), time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 5400, count: 1 },
    ];
    component.recoveryNow = {
      totalSeconds: 5400,
      endTimeMs: Date.UTC(2024, 0, 3, 11, 50, 0),
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.graphic[0].children[0].style.text).not.toBe('Recovery Left Now');
    expect(option.series[0].data.map((entry: { name: string }) => entry.name)).not.toEqual(['Left now', 'Elapsed']);
  });

  it('should format pie center and tooltip values using passed unit settings', async () => {
    component.chartDataType = DataPaceAvg.type;
    component.chartDataValueType = ChartDataValueTypes.Average;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.userUnitSettings = normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile],
    });
    component.data = [
      { type: Date.UTC(2026, 2, 1), time: Date.UTC(2026, 2, 1), [ChartDataValueTypes.Average]: 422.3478623928474, count: 5 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const expectedValue = formatDashboardNumericValue(
      DataPaceAvg.type,
      422.3478623928474,
      undefined as any,
      component.userUnitSettings,
    );
    expect(option.graphic[0].children[1].style.text).toBe(expectedValue);
    expect(option.tooltip.formatter({
      data: {
        name: 'Mar 2026',
        value: 422.3478623928474,
        percent: 100,
        count: 5,
      },
    })).toContain(expectedValue);
  });

  it('should use dark tooltip styles for dark chart theme', async () => {
    component.darkTheme = true;
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 10, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.tooltip.backgroundColor).toBe('rgba(58,62,68,1)');
  });

  it('should keep pie labels and connector lines disabled', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 60, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 40, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    expect(option.series[0].label.show).toBe(false);
    expect(option.series[0].labelLine.show).toBe(false);
  });

  it('should ignore ngOnChanges before chart initialization', () => {
    component.ngOnChanges({
      data: new SimpleChange([], [{ type: 'Running', [ChartDataValueTypes.Total]: 12 }], false)
    });

    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should start a one-minute refresh timer only for active recovery contexts and clear it on destroy', async () => {
    const nowMs = Date.UTC(2024, 0, 3, 12, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 789 as any);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    component.enableRecoveryNowMode = true;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { type: Date.UTC(2024, 0, 3), time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 3600, count: 1 },
    ];
    component.recoveryNow = {
      totalSeconds: 3600,
      endTimeMs: nowMs - (300 * 1000),
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 1000);
    fixture.destroy();
    expect(clearIntervalSpy).toHaveBeenCalledWith(789);

    clearIntervalSpy.mockRestore();
    setIntervalSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it('should fully reset chart option when there is no data', async () => {
    component.data = [];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
    const settings = mockLoader.setOption.mock.calls.at(-1)?.[2];

    expect(option.series).toEqual([]);
    expect(option.tooltip.show).toBe(false);
    expect(component.showNoDataError).toBe(true);
    expect(settings).toEqual({
      notMerge: true,
      lazyUpdate: false
    });
  });

  it('should suppress no-data overlay in curated recovery mode when recovery context is renderable', async () => {
    const nowMs = Date.UTC(2024, 0, 3, 12, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    component.enableRecoveryNowMode = true;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [];
    component.recoveryNow = {
      totalSeconds: 5400,
      endTimeMs: nowMs - (10 * 60 * 1000),
    };

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(component.showNoDataError).toBe(false);
    dateNowSpy.mockRestore();
  });

  it('should show an updating message while curated recovery metrics are stale/building', async () => {
    component.enableRecoveryNowMode = true;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [];
    component.recoveryNow = null;
    component.recoveryNowStatus = 'stale' as any;

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('Recovery is updating');
    expect(component.noDataErrorHint).toBe('We are recalculating your current recovery window.');
    expect(component.noDataErrorIcon).toBe('autorenew');
  });

  it('should show fully-recovered message when curated recovery is ready with no active recovery', async () => {
    const nowMs = Date.UTC(2024, 0, 3, 12, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    component.enableRecoveryNowMode = true;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [];
    component.recoveryNow = {
      totalSeconds: 3600,
      endTimeMs: nowMs - (2 * 3600 * 1000), // expired
    };
    component.recoveryNowStatus = 'ready' as any;

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('No active recovery now');
    expect(component.noDataErrorHint).toBe('You are fully recovered based on your latest activities.');
    expect(component.noDataErrorIcon).toBe('verified');
    dateNowSpy.mockRestore();
  });

  it('should keep default no-data message for failed curated recovery states', async () => {
    component.enableRecoveryNowMode = true;
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [];
    component.recoveryNow = null;
    component.recoveryNowStatus = 'failed' as any;

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('No data yet');
    expect(component.noDataErrorHint).toBe('Try a different date range or metric');
    expect(component.noDataErrorIcon).toBe('pie_chart');
  });

  it('should dispose chart on destroy', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 10, count: 1 },
    ];

    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.destroy();

    expect(mockLoader.dispose).toHaveBeenCalledWith(mockChart);
  });
});
