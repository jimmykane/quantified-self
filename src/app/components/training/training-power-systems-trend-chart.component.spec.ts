import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TrainingPowerSystemsTrendViewModel } from '../../helpers/training-power-systems.helper';
import { getOrCreateEChartsTooltipHost } from '../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../helpers/echarts-tooltip-position.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { TrainingPowerSystemsTrendChartComponent } from './training-power-systems-trend-chart.component';

const DAY_MS = 24 * 60 * 60 * 1000;
const currentDayMs = Date.UTC(2026, 6, 25);

function trend(values: Array<number | null> = [210, null, 224]): TrainingPowerSystemsTrendViewModel {
  return {
    key: 'criticalPowerWatts',
    label: 'Critical power',
    unit: 'W',
    rangeStartDayMs: currentDayMs - (84 * DAY_MS),
    rangeEndDayMs: currentDayMs,
    points: values.map((value, index) => ({
      dayMs: currentDayMs - ((values.length - index - 1) * 7 * DAY_MS),
      value,
      statusText: value === null ? 'Unstable' : 'Ready',
      isCurrent: index === values.length - 1,
    })),
  };
}

function createComponent(): TrainingPowerSystemsTrendChartComponent {
  return new TrainingPowerSystemsTrendChartComponent(
    { init: vi.fn() } as any,
    { error: vi.fn() } as any,
  );
}

async function refresh(component: TrainingPowerSystemsTrendChartComponent): Promise<void> {
  await component.ngAfterViewInit();
}

describe('TrainingPowerSystemsTrendChartComponent', () => {
  it('initializes, updates, resizes, and disposes through the shared ECharts host', async () => {
    const chart = {
      dispatchAction: vi.fn(),
      isDisposed: vi.fn(() => false),
    };
    const eChartsLoader = {
      attachMobileSeriesTapFeedback: vi.fn(() => () => undefined),
      dispose: vi.fn(),
      init: vi.fn().mockResolvedValue(chart),
      resize: vi.fn(),
      setOption: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => undefined),
    };
    await TestBed.configureTestingModule({
      declarations: [TrainingPowerSystemsTrendChartComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: eChartsLoader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrainingPowerSystemsTrendChartComponent);

    fixture.componentRef.setInput('trend', trend());
    fixture.detectChanges();
    await fixture.whenStable();

    const chartElement = fixture.nativeElement.querySelector('.training-power-systems-trend-chart');
    expect(eChartsLoader.init).toHaveBeenCalledWith(chartElement, 'light', undefined);
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(1));
    expect(eChartsLoader.subscribeToViewportResize).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.training-power-systems-trend-empty')).toBeNull();

    fixture.componentRef.setInput('trend', trend([null, null]));
    fixture.detectChanges();
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(2));
    expect(fixture.nativeElement.querySelector('.training-power-systems-trend-empty')?.textContent)
      .toContain('No ready values in this period');

    fixture.destroy();
    expect(eChartsLoader.dispose).toHaveBeenCalledWith(chart);
  });

  it('uses a bounded UTC time axis, a zero baseline, and preserves unavailable gaps', async () => {
    const component = createComponent();
    component.trend = trend();
    component.chartDiv = new ElementRef(document.createElement('div'));
    Object.defineProperty(component.chartDiv.nativeElement, 'clientWidth', { value: 400 });

    await refresh(component);
    const option = (component as any).buildOption();

    expect(option.xAxis).toEqual(expect.objectContaining({
      type: 'time',
      min: currentDayMs - (84 * DAY_MS),
      max: currentDayMs,
    }));
    expect(option.yAxis.min).toBe(0);
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.series[0].data).toEqual([
      [currentDayMs - (14 * DAY_MS), 210],
      [currentDayMs - (7 * DAY_MS), null],
      [currentDayMs, 224],
    ]);
    expect(option.series[0].symbolSize(null, { dataIndex: 0 })).toBe(6);
    expect(option.series[0].symbolSize(null, { dataIndex: 2 })).toBe(9);
    expect(component.hasReadyValues).toBe(true);
    expect(component.chartAriaLabel).toBe('Critical power over the latest 12 weeks');
  });

  it('renders app-standard tooltips for ready and unavailable observations', async () => {
    const component = createComponent();
    component.trend = trend();
    component.chartDiv = new ElementRef(document.createElement('div'));

    await refresh(component);
    const option = (component as any).buildOption();

    expect(option.tooltip).toEqual(expect.objectContaining({
      appendTo: getOrCreateEChartsTooltipHost,
      confine: false,
      position: getViewportConstrainedTooltipPosition,
      triggerOn: 'mousemove|click',
    }));
    expect(option.tooltip.formatter([{ data: [currentDayMs, 224] }])).toContain('224 W');
    expect(option.tooltip.formatter([{
      data: [currentDayMs - (7 * DAY_MS), null],
    }])).toContain('Unavailable · Unstable');
  });

  it('never plots missing evidence as zero and reports a no-ready-values state', async () => {
    const component = createComponent();
    component.trend = trend([null, null]);
    component.chartDiv = new ElementRef(document.createElement('div'));

    await refresh(component);
    const option = (component as any).buildOption();

    expect(component.hasReadyValues).toBe(false);
    expect(component.chartAriaLabel).toContain('no ready values in this period');
    expect(option.series[0].data.every((point: [number, number | null]) => point[1] === null)).toBe(true);
  });
});
