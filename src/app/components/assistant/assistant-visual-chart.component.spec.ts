import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppThemes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { AssistantVisualChartComponent } from './assistant-visual-chart.component';

describe('AssistantVisualChartComponent', () => {
  let fixture: ComponentFixture<AssistantVisualChartComponent>;
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
      imports: [AssistantVisualChartComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: loader },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AssistantVisualChartComponent);
    fixture.componentInstance.visual = {
      kind: 'chart',
      title: 'Sleep trend',
      chartType: 'line',
      xAxis: {
        type: 'time',
        label: 'Date',
        unit: null,
        timeZone: 'Europe/Helsinki',
      },
      series: [{
        label: 'Overnight HRV',
        unit: 'ms',
        points: [
          { x: '2026-08-01T00:00:00.000Z', y: 52 },
          { x: '2026-08-02T00:00:00.000Z', y: null },
        ],
      }],
    };
  });

  it('renders through the shared ECharts host and keeps nulls as gaps', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.ngAfterViewInit();
    expect(loader.setOption).toHaveBeenCalledOnce();

    expect(loader.init).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'light',
      undefined,
    );
    const option = loader.setOption.mock.calls[0][1] as {
      series: Array<{ data: Array<[number, number | null]>; connectNulls: boolean }>;
      xAxis: { axisLabel: { formatter: (value: number) => string } };
    };
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.series[0].data).toEqual([
      [Date.parse('2026-08-01T00:00:00.000Z'), 52],
      [Date.parse('2026-08-02T00:00:00.000Z'), null],
    ]);
    const localMidnight = Date.parse('2026-07-31T21:00:00.000Z');
    expect(option.xAxis.axisLabel.formatter(localMidnight)).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeZone: 'Europe/Helsinki',
      }).format(localMidnight),
    );
  });

  it('disposes the shared chart host on teardown', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.ngAfterViewInit();
    fixture.destroy();

    expect(loader.dispose).toHaveBeenCalledWith(chart);
  });
});
