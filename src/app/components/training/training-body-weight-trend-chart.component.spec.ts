import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TrainingBodyWeightTrendPointViewModel } from '../../helpers/training-body-weight.helper';
import { getOrCreateEChartsTooltipHost } from '../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../helpers/echarts-tooltip-position.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { TrainingBodyWeightTrendChartComponent } from './training-body-weight-trend-chart.component';

const DAY_MS = 24 * 60 * 60 * 1000;
const currentDayMs = Date.UTC(2026, 6, 25);

function points(): TrainingBodyWeightTrendPointViewModel[] {
  return [
    { dayMs: currentDayMs - (2 * DAY_MS), weightKg: 70.5 },
    { dayMs: currentDayMs - DAY_MS, weightKg: null },
    { dayMs: currentDayMs, weightKg: 70.1 },
  ];
}

function createComponent(): TrainingBodyWeightTrendChartComponent {
  return new TrainingBodyWeightTrendChartComponent(
    { init: vi.fn() } as any,
    { error: vi.fn() } as any,
  );
}

describe('TrainingBodyWeightTrendChartComponent', () => {
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
      declarations: [TrainingBodyWeightTrendChartComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: eChartsLoader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrainingBodyWeightTrendChartComponent);

    fixture.componentRef.setInput('points', points());
    fixture.detectChanges();
    await fixture.whenStable();

    const chartElement = fixture.nativeElement.querySelector('.training-body-weight-trend-chart');
    expect(eChartsLoader.init).toHaveBeenCalledWith(chartElement, 'light', undefined);
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(1));

    fixture.componentRef.setInput('darkTheme', true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(2));
    expect(eChartsLoader.init).toHaveBeenLastCalledWith(chartElement, 'dark', undefined);

    fixture.destroy();
    expect(eChartsLoader.dispose).toHaveBeenCalledWith(chart);
  });

  it('uses a UTC time axis, standard tooltips, and preserves missing measurements as gaps', async () => {
    const component = createComponent();
    component.points = points();
    component.chartDiv = new ElementRef(document.createElement('div'));
    Object.defineProperty(component.chartDiv.nativeElement, 'clientWidth', { value: 400 });
    await component.ngAfterViewInit();
    const option = (component as any).buildOption();

    expect(option.xAxis).toEqual(expect.objectContaining({
      type: 'time', min: currentDayMs - (2 * DAY_MS), max: currentDayMs,
    }));
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.series[0].data).toEqual([
      [currentDayMs - (2 * DAY_MS), 70.5],
      [currentDayMs - DAY_MS, null],
      [currentDayMs, 70.1],
    ]);
    expect(option.tooltip).toEqual(expect.objectContaining({
      appendTo: getOrCreateEChartsTooltipHost,
      confine: false,
      position: getViewportConstrainedTooltipPosition,
      triggerOn: 'mousemove|click',
    }));
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).toContain('70.5 kg');
    expect(option.tooltip.formatter([{ dataIndex: 1 }])).toContain('No measurement');
  });
});
