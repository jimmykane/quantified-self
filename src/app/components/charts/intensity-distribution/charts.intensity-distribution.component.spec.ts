import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsIntensityDistributionComponent } from './charts.intensity-distribution.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';

describe('ChartsIntensityDistributionComponent', () => {
  let fixture: ComponentFixture<ChartsIntensityDistributionComponent>;
  let component: ChartsIntensityDistributionComponent;
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

    const mockChart = {
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
      declarations: [ChartsIntensityDistributionComponent],
      imports: [MatButtonModule, MatIconModule],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsIntensityDistributionComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
  });

  it('renders easy/moderate/hard percentages from the latest week', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2025, 11, 31, 12, 0, 0, 0));
    component.distribution = {
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestEasyPercent: 50,
      latestModeratePercent: 30,
      latestHardPercent: 20,
      weeks: [
        {
          weekStartMs: Date.UTC(2025, 11, 29),
          easySeconds: 7200,
          moderateSeconds: 3600,
          hardSeconds: 1800,
          source: 'power',
        },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    dateNowSpy.mockRestore();

    expect(component.easyText).toBe('57%');
    expect(component.moderateText).toBe('29%');
    expect(component.hardText).toBe('14%');
    expect(component.weekContextText.startsWith('Current week')).toBe(true);
  });

  it('shows latest-week context when latest bucket is not current week', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 2, 10, 12, 0, 0, 0));
    component.distribution = {
      latestWeekStartMs: Date.UTC(2025, 11, 29),
      latestEasyPercent: 57,
      latestModeratePercent: 29,
      latestHardPercent: 14,
      weeks: [
        {
          weekStartMs: Date.UTC(2025, 11, 29),
          easySeconds: 7200,
          moderateSeconds: 3600,
          hardSeconds: 1800,
          source: 'power',
        },
      ],
    };

    fixture.detectChanges();
    await fixture.whenStable();
    dateNowSpy.mockRestore();

    expect(component.weekContextText.startsWith('Latest week')).toBe(true);
  });

  it('shows pending no-data message when empty and stale', async () => {
    component.distribution = { latestWeekStartMs: null, latestEasyPercent: null, latestModeratePercent: null, latestHardPercent: null, weeks: [] };
    component.status = 'stale';

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('Intensity distribution is updating');
  });

  it('formats tooltip values as whole percentages with units', async () => {
    const weeks = [
      {
        weekStartMs: Date.UTC(2025, 11, 29),
        easySeconds: 7200,
        moderateSeconds: 3600,
        hardSeconds: 1800,
        source: 'power' as const,
      },
    ];
    component.distribution = {
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestEasyPercent: 50,
      latestModeratePercent: 30,
      latestHardPercent: 20,
      weeks,
    };

    fixture.detectChanges();
    await fixture.whenStable();

    const option = (component as any).buildOption(weeks) as Record<string, any>;
    const formatter = option?.tooltip?.formatter as ((params: Array<{ axisValue?: string | number; seriesName?: string; value?: number }>) => string);

    expect(typeof formatter).toBe('function');

    const tooltipHtml = formatter([
      { axisValue: Date.UTC(2025, 11, 29), seriesName: 'Easy', value: 57.142857 },
      { axisValue: Date.UTC(2025, 11, 29), seriesName: 'Moderate', value: 28.571428 },
      { axisValue: Date.UTC(2025, 11, 29), seriesName: 'Hard', value: 14.285714 },
    ]);

    expect(tooltipHtml).toContain('Week 1,');
    expect(tooltipHtml).toContain('2025 -');
    expect(tooltipHtml).toContain('2026');
    expect(tooltipHtml).toContain('Easy: 57%');
    expect(tooltipHtml).toContain('Moderate: 29%');
    expect(tooltipHtml).toContain('Hard: 14%');
    expect(tooltipHtml).not.toContain('57.1');
  });

  it('keeps tooltip week headings specific when x-axis labels collapse to month-year', () => {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weeks = Array.from({ length: 30 }, (_, index) => ({
      weekStartMs: Date.UTC(2026, 0, 5) + (index * weekMs),
      easySeconds: 7200,
      moderateSeconds: 3600,
      hardSeconds: 1800,
      source: 'power' as const,
    }));

    const option = (component as any).buildOption(weeks) as Record<string, any>;
    const formatter = option?.tooltip?.formatter as ((params: Array<{ axisValue?: string | number; seriesName?: string; value?: number }>) => string);
    const tooltipHtml = formatter([
      { axisValue: Date.UTC(2026, 3, 6), seriesName: 'Easy', value: 57 },
    ]);

    expect(tooltipHtml).toContain('Week 15,');
    expect(tooltipHtml).toContain('Apr');
    expect(tooltipHtml).toContain('2026 -');
    expect(tooltipHtml).not.toContain('Week of Apr 2026');
  });

  it('uses tap-only tooltip triggering on mobile viewport', () => {
    const originalMatchMedia = window.matchMedia;
    const matchMediaSpy = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = matchMediaSpy as unknown as typeof window.matchMedia;

    try {
      const weeks = [
        {
          weekStartMs: Date.UTC(2025, 11, 29),
          easySeconds: 7200,
          moderateSeconds: 3600,
          hardSeconds: 1800,
          source: 'power' as const,
        },
      ];
      const option = (component as any).buildOption(weeks) as Record<string, any>;

      expect(option?.tooltip?.triggerOn).toBe('click');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('formats x-axis labels with year for cross-year ranges', () => {
    const weeks = [
      {
        weekStartMs: Date.UTC(2025, 11, 29),
        easySeconds: 7200,
        moderateSeconds: 3600,
        hardSeconds: 1800,
        source: 'power' as const,
      },
      {
        weekStartMs: Date.UTC(2026, 0, 5),
        easySeconds: 5400,
        moderateSeconds: 1800,
        hardSeconds: 900,
        source: 'power' as const,
      },
    ];

    const option = (component as any).buildOption(weeks) as Record<string, any>;
    const formatter = option?.xAxis?.axisLabel?.formatter as ((value: string | number) => string);

    expect(typeof formatter).toBe('function');
    const label = formatter(Date.UTC(2026, 0, 5));
    expect(label).toContain('2026');
  });

  it('filters to the selected weekly window from the tile header range', async () => {
    const baseWeekMs = Date.UTC(2025, 0, 6);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    component.distribution = {
      latestWeekStartMs: baseWeekMs + (59 * weekMs),
      latestEasyPercent: 50,
      latestModeratePercent: 30,
      latestHardPercent: 20,
      weeks: Array.from({ length: 60 }, (_, index) => ({
        weekStartMs: baseWeekMs + (index * weekMs),
        easySeconds: 3600 + index,
        moderateSeconds: 1800,
        hardSeconds: 900,
        source: 'power' as const,
      })),
    };

    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.chart-range-selector-button')).toBeNull();
    expect((component as any).getVisibleWeeks()).toHaveLength(52);

    component.range = '8w';

    expect(component.selectedRange).toBe('8w');
    expect((component as any).getVisibleWeeks()).toHaveLength(8);
  });
});
