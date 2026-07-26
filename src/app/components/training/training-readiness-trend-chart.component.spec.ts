import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TrainingReadinessTrendPointViewModel } from '../../helpers/training-readiness.helper';
import { getOrCreateEChartsTooltipHost } from '../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../helpers/echarts-tooltip-position.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { TrainingReadinessTrendChartComponent } from './training-readiness-trend-chart.component';

const DAY_MS = 24 * 60 * 60 * 1000;
const currentDayMs = Date.UTC(2026, 6, 25);

function points(): TrainingReadinessTrendPointViewModel[] {
  return [
    {
      dayMs: currentDayMs - (2 * DAY_MS), score: 75, statusLabel: 'Ready', confidence: 'high',
      availableSignalCount: 4, baselineEvidenceCount: 6,
    },
    {
      dayMs: currentDayMs - DAY_MS, score: null, statusLabel: null, confidence: null,
      availableSignalCount: 0, baselineEvidenceCount: 0,
    },
    {
      dayMs: currentDayMs, score: 60, statusLabel: 'Mixed', confidence: 'medium',
      availableSignalCount: 3, baselineEvidenceCount: 4,
    },
  ];
}

function createComponent(): TrainingReadinessTrendChartComponent {
  return new TrainingReadinessTrendChartComponent(
    { init: vi.fn() } as any,
    { error: vi.fn() } as any,
  );
}

describe('TrainingReadinessTrendChartComponent', () => {
  it('initializes and updates through the shared ECharts host', async () => {
    const chart = { dispatchAction: vi.fn(), isDisposed: vi.fn(() => false) };
    const eChartsLoader = {
      attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
      dispose: vi.fn(),
      init: vi.fn().mockResolvedValue(chart),
      resize: vi.fn(),
      setOption: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => undefined),
    };
    await TestBed.configureTestingModule({
      declarations: [TrainingReadinessTrendChartComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: eChartsLoader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrainingReadinessTrendChartComponent);

    fixture.componentRef.setInput('points', points());
    fixture.detectChanges();
    await fixture.whenStable();

    const chartElement = fixture.nativeElement.querySelector('.training-readiness-trend-chart');
    expect(eChartsLoader.init).toHaveBeenCalledWith(chartElement, 'light', undefined);
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(1));

    fixture.componentRef.setInput('darkTheme', true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(2));
    expect(eChartsLoader.init).toHaveBeenLastCalledWith(chartElement, 'dark', undefined);

    fixture.destroy();
    expect(eChartsLoader.dispose).toHaveBeenCalledWith(chart);
  });

  it('uses a fixed readiness scale, threshold markers, standard tooltips, and null gaps', async () => {
    const component = createComponent();
    component.points = points();
    component.chartDiv = new ElementRef(document.createElement('div'));
    Object.defineProperty(component.chartDiv.nativeElement, 'clientWidth', { value: 400 });
    await component.ngAfterViewInit();
    const option = (component as any).buildOption();

    expect(option.xAxis).toEqual(expect.objectContaining({
      type: 'time', min: currentDayMs - (2 * DAY_MS), max: currentDayMs,
    }));
    expect(option.yAxis).toEqual(expect.objectContaining({ type: 'value', min: 0, max: 100, interval: 25 }));
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.series[0].data).toEqual([
      [currentDayMs - (2 * DAY_MS), 75],
      [currentDayMs - DAY_MS, null],
      [currentDayMs, 60],
    ]);
    expect(option.series[0].markLine.data.map((line: { yAxis: number }) => line.yAxis)).toEqual([75, 55]);
    expect(option.tooltip).toEqual(expect.objectContaining({
      appendTo: getOrCreateEChartsTooltipHost,
      confine: false,
      position: getViewportConstrainedTooltipPosition,
      triggerOn: 'mousemove|click',
    }));
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).toContain('75/100');
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).toContain('Ready');
    expect(option.tooltip.formatter([{ dataIndex: 1 }])).toContain('No score');
  });
});
