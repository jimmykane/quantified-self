import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HomeSignalChartsPreviewComponent } from './home-signal-charts-preview.component';

describe('HomeSignalChartsPreviewComponent', () => {
  let fixture: ComponentFixture<HomeSignalChartsPreviewComponent>;
  const chart = {
    dispatchAction: vi.fn(),
    isDisposed: vi.fn(() => false),
  };
  const loader = {
    init: vi.fn().mockResolvedValue(chart),
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    subscribeToViewportResize: vi.fn(() => vi.fn()),
    attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [HomeSignalChartsPreviewComponent],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: EChartsLoaderService, useValue: loader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeSignalChartsPreviewComponent);
  });

  it('renders four compact, anonymous Training chart previews', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

    const widgets = fixture.nativeElement.querySelectorAll('.signal-preview-widget');
    const chartSurfaces = fixture.nativeElement.querySelectorAll('.signal-preview-chart[role="img"]');
    const text = fixture.nativeElement.textContent as string;

    expect(widgets.length).toBe(4);
    expect(chartSurfaces.length).toBe(4);
    expect(text).toContain('Illustrative data');
    expect(text).toContain('Readiness');
    expect(text).toContain('Freshness');
    expect(text).toContain('Intensity mix');
    expect(text).toContain('Efficiency');
    expect(loader.setOption).toHaveBeenCalledTimes(4);
  });

  it('uses silent ECharts series without mobile tap handling', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

    const options = loader.setOption.mock.calls.map(call => call[1] as {
      animation: boolean;
      tooltip: { show: boolean };
      series: Array<{ silent: boolean }>;
    });

    expect(options).toHaveLength(4);
    expect(options.every(option => option.animation === false)).toBe(true);
    expect(options.every(option => option.tooltip.show === false)).toBe(true);
    expect(options.every(option => option.series.every(series => series.silent))).toBe(true);
    expect(loader.attachMobileSeriesTapFeedback).not.toHaveBeenCalled();
  });
});
