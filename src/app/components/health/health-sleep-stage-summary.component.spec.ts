import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SLEEP_PROVIDERS } from '@shared/sleep';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardSleepTrendPoint } from '../../helpers/dashboard-sleep-chart.helper';
import { AppColors } from '../../services/color/app.colors';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HealthSleepStageSummaryComponent } from './health-sleep-stage-summary.component';

function sleepPoint(overrides: Partial<DashboardSleepTrendPoint> = {}): DashboardSleepTrendPoint {
  return {
    id: 'sleep-one',
    sleepDate: '2026-09-04',
    provider: SLEEP_PROVIDERS.SuuntoApp,
    providerLabel: 'Suunto',
    categoryLabel: 'Fri, Sep 4',
    startTimeMs: Date.parse('2026-09-03T22:00:00.000Z'),
    endTimeMs: Date.parse('2026-09-04T06:00:00.000Z'),
    totalSeconds: 28_800,
    deepSeconds: 7_200,
    lightSeconds: 14_400,
    remSeconds: 5_400,
    awakeSeconds: 1_800,
    unknownSeconds: 0,
    score: 80,
    averageHeartRateBpm: 63,
    minimumHeartRateBpm: 51,
    averageHrvMs: 29,
    maxSpo2Percent: 98,
    isNap: false,
    napSeconds: 0,
    napCount: 0,
    napAverageHrvMs: null,
    napAverageHeartRateBpm: null,
    napStartTimeMs: null,
    napEndTimeMs: null,
    ...overrides,
  };
}

describe('HealthSleepStageSummaryComponent', () => {
  let fixture: ComponentFixture<HealthSleepStageSummaryComponent>;
  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(async () => {
    originalResizeObserver = globalThis.ResizeObserver;
    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

    const chart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispatchAction: vi.fn(),
    };
    mockLoader = {
      init: vi.fn().mockResolvedValue(chart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => undefined),
      attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
    };
    await TestBed.configureTestingModule({
      imports: [HealthSleepStageSummaryComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthSleepStageSummaryComponent);
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  it('renders a compact horizontal stage composition with app colors and Sports Lib durations', async () => {
    fixture.componentRef.setInput('point', sleepPoint());
    fixture.componentRef.setInput('sourceLabel', 'Suunto account 2');

    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(mockLoader.setOption).toHaveBeenCalled());

    const optionCall = mockLoader.setOption.mock.calls.at(-1) || [];
    const option = (optionCall[1] || optionCall[0]) as Record<string, any>;
    const host = fixture.nativeElement as HTMLElement;

    expect(option.xAxis).toMatchObject({ type: 'value', show: false, max: 28_800 });
    expect(option.yAxis).toMatchObject({ type: 'category', show: false });
    expect(option.series.map((series: any) => series.name)).toEqual(['Deep', 'Light', 'REM', 'Awake']);
    expect(option.series.map((series: any) => series.data[0])).toEqual([7_200, 14_400, 5_400, 1_800]);
    expect(option.series.map((series: any) => series.itemStyle.color)).toEqual([
      AppColors.DeepBlue,
      AppColors.LightBlue,
      AppColors.Purple,
      AppColors.Orange,
    ]);
    expect(host.querySelector('.sleep-stage-chart')?.getAttribute('aria-label')).toContain('Suunto account 2 sleep stages');
    expect(host.querySelector('.sleep-stage-legend')?.textContent).toContain('Deep02h 00m');
    expect(option.tooltip.formatter()).toContain('02h 00m');
  });

  it('does not imply a stage composition when the provider supplied no known stages', async () => {
    fixture.componentRef.setInput('point', sleepPoint({
      deepSeconds: 0,
      lightSeconds: 0,
      remSeconds: 0,
      awakeSeconds: 0,
      unknownSeconds: 28_800,
    }));
    fixture.componentRef.setInput('sourceLabel', 'Suunto');

    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.sleep-stage-chart')).toBeNull();
    expect(host.textContent).toContain('Sleep stages were not provided for this session.');
    expect(mockLoader.init).not.toHaveBeenCalled();
  });
});
