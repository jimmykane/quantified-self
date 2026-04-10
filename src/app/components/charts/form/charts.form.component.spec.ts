import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsFormComponent } from './charts.form.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import type { DashboardFormPoint } from '../../../helpers/dashboard-form.helper';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe('ChartsFormComponent', () => {
  let fixture: ComponentFixture<ChartsFormComponent>;
  let component: ChartsFormComponent;
  let resizeObserverRecords: ResizeObserverRecord[];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

  let mockChart: {
    isDisposed: ReturnType<typeof vi.fn>;
    dispatchAction: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };

  const waitForChartStabilization = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  const points: DashboardFormPoint[] = [
    {
      time: Date.UTC(2024, 0, 1),
      trainingStressScore: 40,
      ctl: 10.4,
      atl: 14.6,
      formSameDay: -4.2,
      formPriorDay: null,
    },
    {
      time: Date.UTC(2024, 0, 2),
      trainingStressScore: 0,
      ctl: 10,
      atl: 13,
      formSameDay: -3,
      formPriorDay: -4.2,
    },
    {
      time: Date.UTC(2024, 0, 3),
      trainingStressScore: 22,
      ctl: 10.8,
      atl: 12.4,
      formSameDay: -1.6,
      formPriorDay: -3,
    },
  ];

  const buildLongRangePoints = (count: number): DashboardFormPoint[] => (
    Array.from({ length: count }, (_, index) => {
      const ctl = 10 + index * 0.15;
      const atl = 11 + index * 0.1;
      return {
        time: Date.UTC(2024, 0, index + 1),
        trainingStressScore: index % 5 === 0 ? 40 : 0,
        ctl,
        atl,
        formSameDay: ctl - atl,
        formPriorDay: index === 0 ? null : (10 + (index - 1) * 0.15) - (11 + (index - 1) * 0.1),
      };
    })
  );

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

    mockChart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispatchAction: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => { }),
      attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
    };

    await TestBed.configureTestingModule({
      declarations: [ChartsFormComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsFormComponent);
    component = fixture.componentInstance;
    component.darkTheme = false;
    component.isLoading = false;
    component.data = points;
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

  const getLastFullChartOption = (): Record<string, any> => {
    const call = [...mockLoader.setOption.mock.calls]
      .reverse()
      .find(([, option]) => Array.isArray((option as Record<string, unknown>)?.series));
    return (call?.[1] || {}) as Record<string, any>;
  };

  it('should initialize echarts with two panes and default prior-day form series', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastFullChartOption();
    const formSeries = option.series.find((entry: { name?: string }) => entry.name === 'Form (TSB)');
    const topGrid = option.grid?.[0];
    const bottomGrid = option.grid?.[1];

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(Array.isArray(option.grid)).toBe(true);
    expect(option.grid).toHaveLength(2);
    expect(topGrid.left).toBe(bottomGrid.left);
    expect(topGrid.right).toBe(bottomGrid.right);
    expect(topGrid.height).toBe(bottomGrid.height);
    expect(topGrid.outerBoundsMode).toBe('none');
    expect(bottomGrid.outerBoundsMode).toBe('none');
    expect(option.xAxis[0].type).toBe('time');
    expect(option.xAxis[1].type).toBe('time');
    expect(Array.isArray(formSeries.data)).toBe(true);
    expect(formSeries.data).toHaveLength(1);
    expect(formSeries.data[0][1]).toBe(points[points.length - 1].formPriorDay);
    expect(formSeries.symbol).toBe('circle');
    expect(option.dataZoom).toBeUndefined();
    expect(option.toolbox).toBeUndefined();
    expect(option.xAxis[1].minInterval).toBe(7 * DAY_MS);
    expect(option.xAxis[1].splitNumber).toBeGreaterThanOrEqual(2);
    expect(option.xAxis[1].splitNumber).toBeLessThanOrEqual(7);
    expect(typeof option.xAxis[1].axisLabel.formatter).toBe('function');
    expect(mockChart.on).not.toHaveBeenCalledWith('datazoom', expect.any(Function));
    expect(mockChart.on).not.toHaveBeenCalledWith('restore', expect.any(Function));
  });

  it('should expose dynamic status title and rounded headline stats from latest real point', async () => {
    component.absoluteLatestPoint = {
      time: Date.UTC(2024, 1, 5),
      trainingStressScore: 18,
      ctl: 42.2,
      atl: 44.1,
      formSameDay: -1.9,
      formPriorDay: -1.9,
    };

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(component.status().title).toBe('Maintaining fitness');
    expect(component.headlineStats()).toEqual({
      fitness: {
        value: '42',
      },
      fatigue: {
        value: '44',
      },
      form: {
        value: '-2',
      },
      tss: {
        value: '18',
      },
    });
  });

  it('should show safe fallback headline values when latest points are unavailable', async () => {
    component.data = [];

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(component.headlineStats()).toEqual({
      fitness: { value: '--' },
      fatigue: { value: '--' },
      form: { value: '--' },
      tss: { value: '--' },
    });
  });

  it('should show updating no-data messaging while form derived metrics are pending', async () => {
    component.formStatus = 'stale' as any;
    component.data = [];

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(component.noDataErrorMessage).toBe('Training metrics are updating');
    expect(component.noDataErrorHint).toBe('We are recalculating your fitness, fatigue, and form.');
    expect(component.noDataErrorIcon).toBe('autorenew');
  });

  it('should emit empty chart option when there are no form points', async () => {
    component.data = [];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastFullChartOption();
    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
  });

  it('should apply weekly granularity by default with thinner line styling', async () => {
    const longRangePoints = buildLongRangePoints(260);
    component.data = longRangePoints;
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastFullChartOption();
    const formSeries = option.series.find((entry: { name?: string }) => entry.name === 'Form (TSB)');
    const fitnessSeries = option.series.find((entry: { name?: string }) => entry.name === 'Fitness (CTL)');
    const fatigueSeries = option.series.find((entry: { name?: string }) => entry.name === 'Fatigue (ATL)');

    expect(component.selectedGranularity()).toBe('w');
    expect(formSeries.data.length).toBeLessThan(longRangePoints.length);
    expect(option.xAxis[1].axisLabel.rotate).toBe(0);
    expect(option.xAxis[1].minInterval).toBe(7 * DAY_MS);
    expect(option.xAxis[1].splitNumber).toBeGreaterThanOrEqual(2);
    expect(option.xAxis[1].splitNumber).toBeLessThanOrEqual(7);
    expect(option.xAxis[1].min).toBeGreaterThan(longRangePoints[0].time);
    expect(option.xAxis[1].max).toBe(formSeries.data[formSeries.data.length - 1][0]);
    expect(typeof option.xAxis[1].axisLabel.formatter).toBe('function');
    expect(formSeries.symbol).toBe('none');
    expect(fitnessSeries.lineStyle.width).toBe(1.2);
    expect(fatigueSeries.lineStyle.width).toBe(1.2);
    expect(formSeries.lineStyle.width).toBe(1.1);
    expect(option.dataZoom).toBeUndefined();
    expect(option.toolbox).toBeUndefined();
  });

  it('should switch chart timeline window via compact buttons without any zoom/restore toolbar', async () => {
    const longRangePoints = buildLongRangePoints(1200);
    component.data = longRangePoints;
    fixture.detectChanges();
    await waitForChartStabilization();

    const weeklyOption = getLastFullChartOption();
    const weeklyFormSeries = weeklyOption.series.find((entry: { name?: string }) => entry.name === 'Form (TSB)');
    const weeklyLength = weeklyFormSeries.data.length;
    const weeklyMin = weeklyOption.xAxis[1].min;
    const weeklyMax = weeklyOption.xAxis[1].max;

    const granularityToggle = fixture.nativeElement.querySelector('mat-button-toggle-group.form-granularity-toggle');
    expect(granularityToggle).toBeTruthy();
    expect((fixture.nativeElement.textContent || '')).toContain('W');
    expect((fixture.nativeElement.textContent || '')).toContain('M');
    expect((fixture.nativeElement.textContent || '')).toContain('Y');

    component.onGranularityChange('m');
    fixture.detectChanges();
    await waitForChartStabilization();

    const monthlyOption = getLastFullChartOption();
    const monthlyFormSeries = monthlyOption.series.find((entry: { name?: string }) => entry.name === 'Form (TSB)');
    const monthlyLength = monthlyFormSeries.data.length;
    const monthlyMin = monthlyOption.xAxis[1].min;
    const monthlyMax = monthlyOption.xAxis[1].max;

    expect(component.selectedGranularity()).toBe('m');
    expect(monthlyOption.xAxis[1].minInterval).toBe(28 * DAY_MS);
    expect(monthlyOption.xAxis[1].splitNumber).toBeGreaterThanOrEqual(2);
    expect(monthlyOption.xAxis[1].splitNumber).toBeLessThanOrEqual(7);
    expect(monthlyLength).toBe(weeklyLength);
    expect(monthlyMin).toBeLessThan(weeklyMin);
    expect(monthlyMax).toBe(weeklyMax);
    expect(monthlyOption.dataZoom).toBeUndefined();
    expect(monthlyOption.toolbox).toBeUndefined();

    component.onGranularityChange('y');
    fixture.detectChanges();
    await waitForChartStabilization();

    const yearlyOption = getLastFullChartOption();
    const yearlyFormSeries = yearlyOption.series.find((entry: { name?: string }) => entry.name === 'Form (TSB)');
    const yearlyMin = yearlyOption.xAxis[1].min;
    const yearlyMax = yearlyOption.xAxis[1].max;

    expect(component.selectedGranularity()).toBe('y');
    expect(yearlyOption.xAxis[1].minInterval).toBe(365 * DAY_MS);
    expect(yearlyOption.xAxis[1].splitNumber).toBeGreaterThanOrEqual(2);
    expect(yearlyOption.xAxis[1].splitNumber).toBeLessThanOrEqual(7);
    expect(yearlyFormSeries.data.length).toBe(weeklyLength);
    expect(yearlyMin).toBe(yearlyFormSeries.data[0][0]);
    expect(yearlyMax).toBe(weeklyMax);
    expect(yearlyMin).toBeLessThan(monthlyMin);
    expect(yearlyOption.dataZoom).toBeUndefined();
    expect(yearlyOption.toolbox).toBeUndefined();
  });

  it('should render a rich tooltip card with status/date and metric grid', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastFullChartOption();
    const tooltipHtml = option.tooltip.formatter([{ dataIndex: 0 }]);

    expect(tooltipHtml).toContain('qs-form-tooltip-card');
    expect(tooltipHtml).toContain('Fitness');
    expect(tooltipHtml).toContain('Fatigue');
    expect(tooltipHtml).toContain('Form');
    expect(tooltipHtml).toContain('TSS');
    expect(tooltipHtml).toContain('Fitness change');

    const position = option.tooltip.position(
      [0, 0],
      [],
      null,
      null,
      { contentSize: [320, 150], viewSize: [360, 400] },
    );
    expect(position).toEqual([20, 8]);
  });
});
