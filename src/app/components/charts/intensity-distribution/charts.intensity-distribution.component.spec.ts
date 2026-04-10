import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
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

    expect(component.easyText).toBe('57%');
    expect(component.moderateText).toBe('29%');
    expect(component.hardText).toBe('14%');
  });

  it('shows pending no-data message when empty and stale', async () => {
    component.distribution = { latestWeekStartMs: null, latestEasyPercent: null, latestModeratePercent: null, latestHardPercent: null, weeks: [] };
    component.status = 'stale';

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.showNoDataError).toBe(true);
    expect(component.noDataErrorMessage).toBe('Intensity distribution is updating');
  });
});
