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

describe('ChartsFormComponent', () => {
  let fixture: ComponentFixture<ChartsFormComponent>;
  let component: ChartsFormComponent;
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

  const getLastOption = (): Record<string, any> => {
    return mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
  };

  it('should initialize echarts with two panes and default same-day form series', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
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
    expect(formSeries.data).toEqual(points.map(point => point.formSameDay));
    expect(component.formMode()).toBe('same-day');
  });

  it('should switch to prior-day mode and rerender the form series', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    component.onFormModeChange('prior-day');
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const formSeries = option.series.find((entry: { name?: string }) => entry.name === 'Form (TSB)');

    expect(component.formMode()).toBe('prior-day');
    expect(formSeries.data).toEqual(points.map(point => point.formPriorDay));
  });

  it('should expose dynamic status title and rounded headline stats', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    expect(component.status().title).toBe('Maintaining fitness');
    expect(component.headlineStats()).toEqual({
      fitness: '11',
      fatigue: '12',
      form: '-2',
    });
  });

  it('should emit empty chart option when there are no form points', async () => {
    component.data = [];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
  });

  it('should apply coarser dashboard-aligned render granularity for long date ranges', async () => {
    const longRangePoints: DashboardFormPoint[] = Array.from({ length: 120 }, (_, index) => {
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
    });

    component.data = longRangePoints;
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const formSeries = option.series.find((entry: { name?: string }) => entry.name === 'Form (TSB)');

    expect(formSeries.data.length).toBeLessThan(longRangePoints.length);
    expect(option.xAxis[1].axisLabel.rotate).toBe(0);
  });
});
