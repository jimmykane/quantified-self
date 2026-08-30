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
  const appTheme = signal(AppThemes.Normal);
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
    appTheme.set(AppThemes.Normal);
    await TestBed.configureTestingModule({
      imports: [HomeSignalChartsPreviewComponent],
      providers: [
        { provide: AppThemeService, useValue: { appTheme } },
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

  it('matches the canonical Training chart colors in light and dark themes', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(4));

    const readOptions = (start: number) => loader.setOption.mock.calls.slice(start, start + 4).map(call => call[1] as {
      series: Array<{
        lineStyle?: { color: string };
        itemStyle?: { color: string };
      }>;
    });
    const lightOptions = readOptions(0);

    expect(lightOptions[0].series[0].lineStyle?.color).toBe('#6d6e73');
    expect(lightOptions[1].series[0].lineStyle?.color).toBe('#4caf50');
    expect(lightOptions[2].series.map(series => series.itemStyle?.color)).toEqual([
      '#43a047',
      '#fb8c00',
      '#e53935',
    ]);
    expect(lightOptions[3].series[0].lineStyle?.color).toBe('#6d6e73');

    appTheme.set(AppThemes.Dark);
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(8));

    const darkOptions = readOptions(4);
    expect(darkOptions[0].series[0].lineStyle?.color).toBe('rgba(179,180,183,1)');
    expect(darkOptions[1].series[0].lineStyle?.color).toBe('#4caf50');
    expect(darkOptions[3].series[0].lineStyle?.color).toBe('rgba(179,180,183,1)');
  });
});
